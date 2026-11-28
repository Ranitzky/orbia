import { $, toast, closeDialogs, integrationStatus } from "./dom";
import { t } from "./language";
import { ApiError, errorText, api } from "./api";
import { session } from "./session";

export function showLogin() {
  session.authenticated = false;
  $("#setup-screen").hidden = true;
  closeDialogs();
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#password").focus();
}

function updateAccessFields() {
  const needsPassword = $<HTMLSelectElement>("#access-mode").value === "password";
  $<HTMLInputElement>("#new-password").required = needsPassword;
  $<HTMLInputElement>("#new-password").disabled = !needsPassword;
  $("#new-password-field").hidden = !needsPassword;
  $("#open-access-hint").hidden = needsPassword;
}
export function prepareAccessForm(setup: boolean) {
  const form = $<HTMLFormElement>("#access-form");
  form.reset();
  $("#access-status").textContent = "";
  $(setup ? "#setup-container" : "#access-settings").append(form);
  const current = !setup && session.accessMode === "password";
  $("#current-password-field").hidden = !current;
  $<HTMLInputElement>("#current-password").required = current;
  $<HTMLSelectElement>("#access-mode").value = session.accessMode === "open" ? "open" : "password";
  updateAccessFields();
}
$<HTMLSelectElement>("#access-mode").addEventListener("change", updateAccessFields);

export function bindAccess(start: () => Promise<void>) {
  $<HTMLFormElement>("#access-form").addEventListener("submit", async event => {
    event.preventDefault();
    const setup = session.accessMode === "setup";
    const button = $<HTMLButtonElement>("#access-form button");
    button.disabled = true;
    const mode = $<HTMLSelectElement>("#access-mode").value === "open" ? "open" : "password";
    const payload = {
      mode,
      password: mode === "password" ? $<HTMLInputElement>("#new-password").value : "",
      current: $<HTMLInputElement>("#current-password").value,
    };
    integrationStatus("#access-status", "");
    try {
      await api(setup ? "/auth/setup" : "/auth/password", {method: "POST", body: JSON.stringify(payload)});
      session.accessMode = mode;
      prepareAccessForm(false);
      if (setup) await start();
      else {
        $('[data-action="logout"]').hidden = mode === "open";
        integrationStatus("#access-status", t("access.saved"));
      }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 401)) {
        await start();
      } else {
        integrationStatus("#access-status", !setup && (error instanceof ApiError && error.status === 403)
          ? t("access.incorrectPassword")
          : errorText(error), true);
      }
    } finally {
      button.disabled = false;
    }
  });

  $<HTMLFormElement>("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $<HTMLButtonElement>("#login-form button");
    button.disabled = true;
    $("#login-error").textContent = "";
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: $<HTMLInputElement>("#password").value }),
      });
      $<HTMLInputElement>("#password").value = "";
      await start();
    } catch (error) {
      $("#login-error").textContent =
        (error instanceof ApiError && error.status === 401) ? t("auth.incorrectPassword") : errorText(error);
    } finally {
      button.disabled = false;
    }
  });
}

export async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
    showLogin();
  } catch (error) {
    toast(errorText(error), true);
  }
}
