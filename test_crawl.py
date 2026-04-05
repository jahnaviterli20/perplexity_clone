import sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

import asyncio
from crawl4ai import AsyncWebCrawler

async def main():
    async with AsyncWebCrawler(verbose=False) as crawler:
        result = await crawler.arun(url="https://example.com")
        print("Success:", result.markdown[:100] if result.markdown else "No markdown")

asyncio.run(main())
