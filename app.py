from flask import Flask, render_template, request, jsonify
from google import genai
from google.genai import types
from pypdf import PdfReader
from pdfminer.high_level import extract_text as pdfminer_extract
from ddgs import DDGS
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode
import nest_asyncio
import asyncio
import io
import os
import json
import sys

# Allow nested asyncio.run() inside Flask's synchronous routes
nest_asyncio.apply()

# Ensure UTF-8 output for Windows terminals to prevent Crawl4AI rich logging crashes
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

app = Flask(__name__)

# HARDCODED AS REQUESTED (for demo only)
API_KEY = "AIzaSyCvtKdzMZfWNDtBgj4h7ssMKZPTKSg0Ll8"

# Initialize the Gemini Client
client = genai.Client(api_key=API_KEY)

# In-memory PDF context
PDF_CONTEXT = ""
PDF_FILENAME = ""

THREADS_FILE = "threads.json"

def load_threads():
    if not os.path.exists(THREADS_FILE):
        return {}
    try:
        with open(THREADS_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

def save_threads(threads):
    with open(THREADS_FILE, "w") as f:
        json.dump(threads, f, indent=4)

def get_current_phase(history_text):
    """Simple heuristic to detect the current phase from the history."""
    if "PHASE 5" in history_text or "PHASE: 5" in history_text: return 5
    if "PHASE 4" in history_text or "PHASE: 4" in history_text: return 4
    if "PHASE 3" in history_text or "PHASE: 3" in history_text: return 3
    if "PHASE 2" in history_text or "PHASE: 2" in history_text: return 2
    return 1

# ──────────────────────────────────────────────
# Helpers: Web Search + Crawl
# ──────────────────────────────────────────────

def needs_web_search(query):
    """Web search is ON by default. Only skip for pure greetings/chit-chat."""
    # List of generic greetings to skip search for
    greetings = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'cool']
    q = query.lower().strip().rstrip('?!.')
    if q in greetings or len(q) < 4:
        return False
    return True

def generate_search_query(user_prompt):
    """Use Gemini to generate a concise, keyword-based search query."""
    try:
        query_prompt = (
            "Convert this user prompt into a short, effective keyword search query for DuckDuckGo. "
            "Respond ONLY with the search query text.\n\n"
            f"User Prompt: {user_prompt}"
        )
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=query_prompt
        )
        return response.text.strip().replace('"', '')
    except Exception:
        return user_prompt

def search_duckduckgo(query, max_results=5):
    """Search DuckDuckGo and return results [{title, href, body}]."""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        return results
    except Exception as e:
        print(f"DEBUG: DuckDuckGo search failed: {e}")
        return []

async def crawl_and_extract_urls(urls, max_chars_per_page=5000):
    """Crawl multiple URLs using Crawl4AI and return concatenated markdown."""
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=40,
    )
    crawled_data = []
    try:
        async with AsyncWebCrawler() as crawler:
            results = await crawler.arun_many(urls=urls, config=config)
            for result in results:
                if result.success and result.markdown:
                    text = result.markdown.strip()[:max_chars_per_page]
                    crawled_data.append({"url": result.url, "content": text})
    except Exception as e:
        print(f"DEBUG: Crawl4AI error: {e}")
    return crawled_data

def run_web_search_pipeline(user_prompt):
    """Full pipeline: optimize query → search → crawl → return context."""
    search_query = generate_search_query(user_prompt)
    search_results = search_duckduckgo(search_query, max_results=5)
    
    if not search_results:
        return [], "", search_query

    sources = []
    urls_to_crawl = []
    for r in search_results:
        sources.append({
            "title": r.get("title", ""),
            "url": r.get("href", ""),
            "snippet": r.get("body", "")
        })
        urls_to_crawl.append(r.get("href", ""))

    try:
        crawled_pages = asyncio.run(crawl_and_extract_urls(urls_to_crawl))
    except Exception:
        crawled_pages = []

    context_parts = []
    for i, src in enumerate(sources):
        content = src["snippet"]
        for cp in crawled_pages:
            if cp["url"] == src["url"]:
                content = cp["content"]
                break
        context_parts.append(f"[{i+1}] {src['title']}\nURL: {src['url']}\n{content}")

    return sources, "\n\n---\n\n".join(context_parts), search_query

# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/threads", methods=["GET"])
def get_threads():
    threads = load_threads()
    # Return brief metadata for the sidebar
    return jsonify([{"id": tid, "title": t["title"], "date": t.get("date", "")} for tid, t in threads.items()])

@app.route("/thread/<thread_id>", methods=["GET"])
def get_thread(thread_id):
    threads = load_threads()
    return jsonify(threads.get(thread_id, {"history": []}))

@app.route("/thread", methods=["POST"])
def create_thread():
    data = request.json
    title = data.get("title", "New Chat")
    thread_id = str(int(asyncio.get_event_loop().time() * 1000))
    threads = load_threads()
    threads[thread_id] = {"title": title, "history": [], "date": "Just now"}
    save_threads(threads)
    return jsonify({"id": thread_id})

@app.route("/thread/<thread_id>", methods=["DELETE"])
def delete_thread(thread_id):
    threads = load_threads()
    if thread_id in threads:
        del threads[thread_id]
        save_threads(threads)
        return jsonify({"message": "Deleted"})
    return jsonify({"error": "Not found"}), 404

@app.route("/upload", methods=["POST"])
def upload_pdf():
    global PDF_CONTEXT, PDF_FILENAME
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No file"}), 400
    
    try:
        PDF_FILENAME = file.filename
        file_bytes = file.read()
        reader = PdfReader(io.BytesIO(file_bytes))
        text = [page.extract_text() for page in reader.pages if page.extract_text()]
        PDF_CONTEXT = "\n".join(text)
        return jsonify({"message": f"Indexed {file.filename}", "char_count": len(PDF_CONTEXT)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/clear_context", methods=["POST"])
def clear_context():
    global PDF_CONTEXT, PDF_FILENAME
    PDF_CONTEXT = ""; PDF_FILENAME = ""
    return jsonify({"message": "Cleared"})

@app.route("/audio_chat", methods=["POST"])
def audio_chat():
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file"}), 400
    
    audio_file = request.files['audio']
    audio_bytes = audio_file.read()
    
    try:
        # Re-initialize client to ensure latest key is used
        local_client = genai.Client(api_key=API_KEY)
        
        # We ask Gemini to transcribe the audio. 
        # Using gemini-2.5-flash model
        response = local_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[
                "Transcribe this audio message exactly. If there is no speech, respond with an empty string. "
                "Respond ONLY with the transcription text.",
                types.Part.from_bytes(data=audio_bytes, mime_type='audio/webm')
            ]
        )
        transcript = response.text.strip()
        return jsonify({"transcript": transcript})
    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
            return jsonify({"error": "API Rate Limit Exceeded. Wait a few seconds and try again."}), 429
        print(f"Audio processing error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    user_prompt = data.get("prompt", "")
    mode = data.get("mode", "auto")
    history = data.get("history", [])
    if not user_prompt: return jsonify({"error": "No prompt"}), 400

    try:
        sources = []; _search_query = ""
        history_text = "\n".join([f"{item['role'].upper()}: {item['content']}" for item in history[-6:]]) # limit to last 6 turns to save context length
        
        # Determine if web search is needed based on mode
        is_business_mode = (mode == "business")
        is_search_mode = (mode == "search")
        force_search = is_search_mode or is_business_mode
        
        if PDF_CONTEXT.strip() and not force_search:
            sources = [{"title": f"PDF: {PDF_FILENAME}", "url": "#local-pdf", "snippet": "Document Content"}]
            prompt = (
                "Answer this question based ONLY on the provided PDF text. Be brief.\n"
                f"CONTEXT:\n{PDF_CONTEXT[:50000]}\n\nQUESTION: {user_prompt}"
            )
        
        current_phase = 0
        if is_business_mode:
            sources, web_context, _search_query = run_web_search_pipeline(user_prompt)
            bizmind_rules = """You are BizMind, an AI startup accelerator inside PlexOra. 
Your goal is to validate business ideas and guide users through startup strategy with perfect clarity and brevity.

1. INITIAL IDEA: If the user provides a business idea, you must give a brief 5-POINT VALIDATION covering:
   - 1. Idea Viability: TAM/UVP analysis.
   - 2. Market/Competitors: Key trends and gaps.
   - 3. Marketing: Primary growth channels.
   - 4. Financials: Basic burn/revenue model.
   - 5. Legal: Essential registrations.
   AT THE END OF THIS SUMMARY, ask: "Which of these 5 areas should I explore more for you?"

2. DEEP DIVE: If the user asks for a specific area (e.g., "Marketing Strategy") or clicks one:
   - Provide a PERFECT, CLEAR, and DETAILED response for that specific sub-module.
   - AT THE END, ask: "Would you like to explore another area from the 5 points (Ideation, Market, Marketing, Finance, Legal)?"

3. TONE: Be professional, strategic, and encouraging. Focus on effectiveness in the Indian market.
4. CRITICAL: Use markdown headers and bullet points. At the very end of your response, output [PHASE: X] where X is 1 (Idea), 2 (Market), 3 (Marketing), 4 (Finance), or 5 (Legal) based on the current focus."""

            prompt = (
                f"{bizmind_rules}\n\n"
                f"RECENT CHAT HISTORY:\n{history_text}\n\n"
                f"WEB SEARCH CONTEXT:\n{web_context}\n\n"
                f"USER SAYS: {user_prompt}"
            )
        elif is_search_mode:
            sources, web_context, _search_query = run_web_search_pipeline(user_prompt)
            if web_context:
                prompt = (
                    "You are a search assistant. Answer the question clearly and directly based on the web context.\n"
                    "You MUST CITE your sources using [1], [2], etc. inline in the text for every key point.\n\n"
                    f"CONTEXT:\n{web_context}\n\nQUESTION: {user_prompt}"
                )
            else:
                prompt = f"Answer briefly from general knowledge: {user_prompt}"
        else:
            # Basic mode (no search, no crawling) - Friendly Persona
            prompt = (
                "You are a friendly, conversational AI companion inside PlexOra. "
                "Keep your responses warm, helpful, and natural. Do not use web search or citations. "
                "Chat like a supportive friend.\n\n"
                f"USER SAYS: {user_prompt}"
            )

        # Re-initialize client to ensure latest key is used
        local_client = genai.Client(api_key=API_KEY)
        response = local_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        bot_response = response.text
        
        # Extract phase info
        if "[PHASE: " in bot_response:
            try:
                parts = bot_response.split("[PHASE: ")
                current_phase = int(parts[1].split("]")[0])
                bot_response = parts[0].strip() # remove tag from user view
            except:
                pass
        
        # Auto-detect if bot didn't tag
        if current_phase == 0 and is_business_mode:
             current_phase = get_current_phase(bot_response + history_text)

        # Save to history if thread_id provided
        thread_id = data.get("thread_id")
        if thread_id:
            threads = load_threads()
            if thread_id in threads:
                if not threads[thread_id]["history"]:
                    # Update title from first prompt
                    threads[thread_id]["title"] = user_prompt[:30] + ("..." if len(user_prompt) > 30 else "")
                threads[thread_id]["history"].append({"role": "user", "content": user_prompt})
                threads[thread_id]["history"].append({"role": "model", "content": bot_response})
                save_threads(threads)

        return jsonify({
            "response": bot_response, 
            "sources": sources, 
            "search_query": _search_query,
            "current_phase": current_phase
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        error_msg = str(e)
        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
            return jsonify({"error": "API Rate Limit Exceeded. Please wait a few seconds and try again."}), 429
        print(f"Error: {e}")
        return jsonify({"error": "An error occurred. Please try again."}), 500

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)
