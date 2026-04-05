import sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
import asyncio
import os
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode, LLMConfig
from crawl4ai.extraction_strategy import LLMExtractionStrategy

API_KEY = "AIzaSyAhkgVNtR2Hn5MqomphoBPFR9LM0TrqR8I"

async def main():
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        extraction_strategy=LLMExtractionStrategy(
            llm_config=LLMConfig(
                provider="gemini/gemini-2.5-flash",
                api_token=API_KEY
            ),
            instruction="Extract a short summary of this webpage. Do not include markdown formatting or json, just text."
        )
    )
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url="https://example.com", config=config)
        print("Success:", result.extracted_content)

asyncio.run(main())
