import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC


pytestmark = pytest.mark.e2e


def login(driver, wait, frontend_url: str, email: str, password: str):
    driver.get(f"{frontend_url}/login")
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='login-email']"))).clear()
    driver.find_element(By.CSS_SELECTOR, "[data-testid='login-email']").send_keys(email)
    driver.find_element(By.CSS_SELECTOR, "[data-testid='login-password']").send_keys(password)
    driver.find_element(By.CSS_SELECTOR, "[data-testid='login-submit']").click()


def test_invalid_login_shows_error(env, driver, wait):
    login(driver, wait, env.frontend_url, "noexiste@example.com", "badpass")
    err = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "[data-testid='login-error']")))
    assert err.text.strip() != ""


def test_admin_can_login_and_logout(env, demo_users, driver, wait):
    admin = demo_users["admin"]
    login(driver, wait, env.frontend_url, admin["email"], admin["password"])

    wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "[data-testid='admin-dashboard-title']")))
    driver.find_element(By.CSS_SELECTOR, "[data-testid='logout']").click()
    wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "[data-testid='login-submit']")))


def test_resident_can_login(env, demo_users, driver, wait):
    resident = demo_users["resident"]
    login(driver, wait, env.frontend_url, resident["email"], resident["password"])
    wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "[data-testid='resident-dashboard-title']")))

