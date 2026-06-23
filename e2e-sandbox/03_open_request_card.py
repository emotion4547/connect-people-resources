"""HR opens the first request's details dialog."""
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
        await page.wait_for_load_state("networkidle")

        details = page.get_by_role("button", name="Детали")
        count = await details.count()
        if count == 0:
            await page.screenshot(path=str(SH / "no_requests.png"))
            print("SKIP: HR has no requests, cannot open card")
            await close_context(ctx)
            return

        await details.first.click()
        # Dialog title is "Детали заявки"
        await page.wait_for_selector('text="Детали заявки"', timeout=5000)
        await page.screenshot(path=str(SH / "request_card.png"))

        # Sanity-check that the dialog actually renders structured fields
        for label in ["Должность", "Дата", "Адрес"]:
            assert await page.locator(f"text={label}").count() > 0, f"missing field: {label}"

        print("OK: request card opened")
        await close_context(ctx)


asyncio.run(main())
