"""HR sees the requests list at /hr/requests."""
import asyncio
from playwright.async_api import async_playwright

from _helpers import BASE_URL, HR, login, new_context, close_context, screenshots_dir

SH = screenshots_dir(__file__)


async def main():
    async with async_playwright() as pw:
        ctx = await new_context(pw)
        page = await ctx.new_page()
        await login(page, HR, "/hr/")
        await page.goto(f"{BASE_URL}/hr/requests", wait_until="domcontentloaded")
        # Wait for either a row or the empty state to appear.
        await page.wait_for_selector("table, text=Заявок пока нет", timeout=10000)
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SH / "requests_list.png"))

        rows = await page.locator("tbody tr").count()
        has_empty = await page.locator("text=Заявок пока нет").count()
        print(f"rows={rows} empty_state={bool(has_empty)} url={page.url}")
        assert rows > 0 or has_empty > 0, "neither table rows nor empty state shown"
        print("OK: requests list rendered")

        await close_context(ctx)


asyncio.run(main())
