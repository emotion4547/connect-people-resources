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
        # Support pages use a textarea or input plus a send button. Try both.
        textarea = page.locator('textarea, input[type="text"]').filter(
            has_text=""
        )
        # Prefer the placeholder hint typical for chat
        chat_input = page.get_by_placeholder("Введите сообщение")
        if await chat_input.count() == 0:
            chat_input = page.locator("textarea").last
        await chat_input.fill(msg)
        await page.screenshot(path=str(SH / "support_typed.png"))

        # Send: button with Send icon or text "Отправить"
        send_btn = page.get_by_role("button", name="Отправить")
        if await send_btn.count() == 0:
            send_btn = page.locator('button:has(svg)').last
        await send_btn.click()

        await page.wait_for_selector(f'text="{msg}"', timeout=10000)
        await page.screenshot(path=str(SH / "support_after_send.png"))
        print("OK: message delivered ->", msg)

        await close_context(ctx)


asyncio.run(main())
