"""Realtime smoke test: HR creates a request, Admin's /admin/requests reflects it
without a manual reload.
"""
import asyncio
import time
from playwright.async_api import async_playwright

from _helpers import BASE_URL, HR, ADMIN, login, new_context, close_context, screenshots_dir

SH = screenshots_dir(__file__)


async def main():
    async with async_playwright() as pw:
        # Admin context first — open the requests list and snapshot row count.
        admin_ctx = await new_context(pw)
        admin_page = await admin_ctx.new_page()
        await login(admin_page, ADMIN, "/admin/")
        await admin_page.goto(f"{BASE_URL}/admin/requests", wait_until="domcontentloaded")
        await admin_page.wait_for_load_state("networkidle")
        await admin_page.screenshot(path=str(SH / "admin_before.png"))
        before = await admin_page.locator("tbody tr").count()
        print("admin rows before:", before)

        # HR context — create a unique request via UI.
        hr_ctx = await new_context(pw)
        hr_page = await hr_ctx.new_page()
        await login(hr_page, HR, "/hr/")
        await hr_page.goto(f"{BASE_URL}/hr/create-request", wait_until="domcontentloaded")
        await hr_page.wait_for_load_state("networkidle")

        # Mode dialog: click "Создать вручную"
        manual_btn = hr_page.get_by_role("button", name="Создать вручную")
        if await manual_btn.count() > 0:
            await manual_btn.click()

        # Pick first available site (skip if HR is not assigned to any).
        site_trigger = hr_page.locator('button:has-text("Выберите объект")')
        if await site_trigger.count() == 0:
            no_sites = await hr_page.get_by_text("Вы не закреплены ни за одним объектом").count()
            if no_sites:
                print("SKIP: HR has no sites assigned; cannot create request")
                await close_context(hr_ctx)
                await close_context(admin_ctx)
                return
        else:
            await site_trigger.first.click()
            await hr_page.locator('[role="option"]').first.click()

        # Position
        pos_trigger = hr_page.locator('button:has-text("Выберите должность")')
        await pos_trigger.first.click()
        await hr_page.locator('[role="option"]').first.click()

        # Dates: today and tomorrow
        today = time.strftime("%Y-%m-%d")
        tomorrow = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400))
        await hr_page.fill("#startDate", today)
        await hr_page.fill("#endDate", tomorrow)

        tag = f"E2E-RT-{int(time.time())}"
        await hr_page.fill("#address", f"Москва, {tag}")
        await hr_page.fill("#pay", "1000 ₽")
        await hr_page.screenshot(path=str(SH / "hr_form_filled.png"))

        await hr_page.get_by_role("button", name="Создать заявку").click()
        # Wait for navigation to /hr/requests
        await hr_page.wait_for_url("**/hr/requests*", timeout=20000)
        await hr_page.screenshot(path=str(SH / "hr_after_create.png"))
        print("HR created request with tag:", tag)

        # Realtime: admin should see one extra row without manual reload.
        try:
            await admin_page.wait_for_function(
                f"document.querySelectorAll('tbody tr').length > {before}",
                timeout=15000,
            )
            after = await admin_page.locator("tbody tr").count()
            print(f"admin rows after: {after} (delta={after - before})")
            await admin_page.screenshot(path=str(SH / "admin_after.png"))
            assert after > before, "admin row count did not increase"
            print("OK: realtime update propagated HR -> Admin")
        except Exception as e:
            await admin_page.screenshot(path=str(SH / "admin_timeout.png"))
            raise

        await close_context(hr_ctx)
        await close_context(admin_ctx)


asyncio.run(main())
