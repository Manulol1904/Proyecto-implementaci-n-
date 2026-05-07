import os
from dataclasses import dataclass

import pytest
import requests
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.support.ui import WebDriverWait


load_dotenv()


@dataclass(frozen=True)
class Env:
    frontend_url: str
    backend_url: str
    payments_url: str
    browser: str
    headless: bool


def _env() -> Env:
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
    payments_url = os.getenv("PAYMENTS_URL", "http://localhost:8002").rstrip("/")
    browser = os.getenv("BROWSER", "chrome").strip().lower()
    headless = os.getenv("HEADLESS", "1").strip() not in ("0", "false", "False", "")
    return Env(
        frontend_url=frontend_url,
        backend_url=backend_url,
        payments_url=payments_url,
        browser=browser,
        headless=headless,
    )


@pytest.fixture(scope="session")
def env() -> Env:
    return _env()


@pytest.fixture(scope="session")
def demo_users(env: Env) -> dict:
    """
    Crea usuarios demo desde el backend y retorna credenciales.
    Esperado: POST /admin/seed-demo → { admin: {email,password}, resident: {email,password} }
    """
    r = requests.post(f"{env.backend_url}/admin/seed-demo", timeout=30)
    r.raise_for_status()
    data = r.json()
    assert "admin" in data and "residents" in data, f"Respuesta inesperada seed-demo: {data}"
    # Para conveniencia de tests: expone un "resident" principal.
    residents = data.get("residents") or []
    assert isinstance(residents, list) and len(residents) > 0
    data["resident"] = residents[0]
    return data


def _make_driver(env: Env):
    if env.browser == "edge":
        options = EdgeOptions()
        if env.headless:
            options.add_argument("--headless=new")
        options.add_argument("--window-size=1440,900")
        return webdriver.Edge(options=options)

    # default: chrome
    options = ChromeOptions()
    if env.headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1440,900")
    return webdriver.Chrome(options=options)


@pytest.fixture()
def driver(env: Env):
    d = _make_driver(env)
    d.set_page_load_timeout(30)
    yield d
    d.quit()


@pytest.fixture()
def wait(driver):
    return WebDriverWait(driver, 12)

