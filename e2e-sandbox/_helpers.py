"""Shared helpers for sandbox Playwright scripts."""
from pathlib import Path
from playwright.async_api import Page, BrowserContext

BASE_URL = "http://localhost:8080"

HR = {"email": "hr@gmail.com", "password": "TestHR123!"}
ADMIN = {"email": "admin@gmail.com", "password": "TestAdm123!"}


def screenshots_dir(script_file: str) -> Path:
    slug = Path(script_file).stem
    d = Path(__file__).parent / "screenshots" / slug
    d.mkdir(parents=True, exist_ok=True)
    return d


async def login(page: Page, user: dict, expected_path: str) -> None:
    """Fill the login form and wait for the post-login route."""
    await page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
    await page.fill("#email", user["email"])
    await page.fill("#password", user["password"])
    await page.click('button[type="submit"]')
    await page.wait_for_url(f"**{expected_path}**", timeout=15000)


async def new_context(playwright, **kwargs) -> BrowserContext:
    browser = await playwright.chromium.launch(headless=True)
    ctx = await browser.new_context(viewport={"width": 1280, "height": 1800}, **kwargs)
    ctx._browser_ref = browser  # keep ref so it isn't GC'd
    return ctx


async def close_context(ctx: BrowserContext) -> None:
    browser = getattr(ctx, "_browser_ref", None)
    await ctx.close()
    if browser:
        await browser.close()
