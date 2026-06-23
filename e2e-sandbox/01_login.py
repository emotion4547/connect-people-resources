"""Login both HR and Admin, screenshot each landing dashboard."""
import asyncio
from playwright.async_api import async_playwright

from _helpers import HR, ADMIN, login, new_context, close_context, screenshots_dir

SH = screenshots_dir(__file__)


async def main():
    async with async_playwright() as pw:
        # HR
        hr_ctx = await new_context(pw)
        hr_page = await hr_ctx.new_page()
        await login(hr_page, HR, "/hr/")
        await hr_page.wait_for_load_state("networkidle")
        await hr_page.screenshot(path=str(SH / "hr_after_login.png"))
        print("HR landed at:", hr_page.url)
        assert "/hr/" in hr_page.url, f"HR did not land on hr route: {hr_page.url}"
        await close_context(hr_ctx)

        # Admin
        admin_ctx = await new_context(pw)
        admin_page = await admin_ctx.new_page()
        await login(admin_page, ADMIN, "/admin/")
        await admin_page.wait_for_load_state("networkidle")
        await admin_page.screenshot(path=str(SH / "admin_after_login.png"))
        print("Admin landed at:", admin_page.url)
        assert "/admin/" in admin_page.url, f"Admin did not land on admin route: {admin_page.url}"
        await close_context(admin_ctx)

        print("OK: both logins succeeded")


asyncio.run(main())
