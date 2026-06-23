"""HR opens support page and sends a message; verify it appears in the thread."""
import asyncio
import time
from playwright.async_api import async_playwright

from _helpers import BASE_URL, HR, login, new_context, close_context, screenshots_dir

SH = screenshots_dir(__file__)


async def main():
    async with async_playwright() as pw:
        ctx = await new_context(pw)
        page = await ctx.new_page()
        await login(page, HR, "/hr/")
        await page.goto(f"{BASE_URL}/hr/support", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SH / "support_open.png"))

        msg = f"[e2e ping {int(time.time())}]"

        # If no chat exists yet, the page may show a "create chat" prompt.
        # The form input has placeholder "Написать сообщение..." once chat is open.
        chat_input = page.get_by_placeholder("Написать сообщение...")
        if await chat_input.count() == 0:
            # Try creating a new chat
            start_btn = page.get_by_role("button", name="Начать чат")
            if await start_btn.count() == 0:
                start_btn = page.get_by_role("button", name="Новый чат")
            if await start_btn.count() > 0:
                await start_btn.first.click()
                await page.wait_for_selector('[placeholder="Написать сообщение..."]', timeout=10000)
                chat_input = page.get_by_placeholder("Написать сообщение...")

        await chat_input.first.fill(msg)
        await page.screenshot(path=str(SH / "support_typed.png"))

        # Submit via Enter on the form (input is inside <form onSubmit>)
        await chat_input.first.press("Enter")

        await page.wait_for_selector(f'text="{msg}"', timeout=10000)
        await page.screenshot(path=str(SH / "support_after_send.png"))
        print("OK: message delivered ->", msg)

        await close_context(ctx)


asyncio.run(main())
