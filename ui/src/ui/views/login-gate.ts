import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";
import { listMockPortalUsers, resolveMockPortalUser } from "../mock-portal-auth.ts";
import { normalizeBasePath } from "../navigation.ts";
import { agentLogoUrl } from "./agents-utils.ts";

export function renderLoginGate(state: AppViewState) {
  const basePath = normalizeBasePath(state.basePath ?? "");
  const faviconSrc = agentLogoUrl(basePath);
  const portalUsers = listMockPortalUsers();
  const currentPortalUser = resolveMockPortalUser(state.mockPortalUserId);

  return html`
    <div class="login-gate">
      <div class="login-gate__card">
        <div class="login-gate__header">
          <img class="login-gate__logo" src=${faviconSrc} alt="OpenClaw" />
          <div class="login-gate__title">OpenClaw</div>
          <div class="login-gate__sub">${t("login.subtitle")}</div>
        </div>
        <div class="login-gate__form">
          <div class="login-gate__section">
            <div class="login-gate__section-header">
              <div class="login-gate__section-title">Mock User Login</div>
              <div class="login-gate__section-subtitle">
                Choose one built-in user ID to simulate portal login and isolate the chat session.
              </div>
            </div>
            ${
              currentPortalUser
                ? html`<div class="callout success">
                    <div><strong>${currentPortalUser.name}</strong> is signed in as <code>${currentPortalUser.id}</code>.</div>
                    <div style="margin-top: 6px;">${currentPortalUser.description}</div>
                  </div>`
                : ""
            }
            <div class="login-gate__user-grid">
              ${portalUsers.map(
                (user) => html`
                  <button
                    type="button"
                    class="login-gate__user-option ${state.mockPortalUserId === user.id ? "login-gate__user-option--active" : ""}"
                    @click=${() => state.handleMockPortalLogin(user.id)}
                  >
                    <span class="login-gate__user-name">${user.name}</span>
                    <span class="login-gate__user-id">${user.id}</span>
                    <span class="login-gate__user-description">${user.description}</span>
                  </button>
                `,
              )}
            </div>
            <label class="field">
              <span>User ID</span>
              <div class="login-gate__mock-login-row">
                <input
                  .value=${state.mockPortalLoginInput}
                  @input=${(e: Event) => {
                    state.mockPortalLoginInput = (e.target as HTMLInputElement).value;
                    state.mockPortalLoginError = null;
                  }}
                  placeholder="u1001"
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      state.handleMockPortalLogin();
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn primary"
                  @click=${() => state.handleMockPortalLogin()}
                >
                  ${currentPortalUser ? "Switch User" : "Sign In"}
                </button>
                ${
                  currentPortalUser
                    ? html`<button
                        type="button"
                        class="btn"
                        @click=${() => state.handleMockPortalLogout()}
                      >
                        Log Out
                      </button>`
                    : ""
                }
              </div>
            </label>
            ${
              state.mockPortalLoginError
                ? html`<div class="callout danger">
                    <div>${state.mockPortalLoginError}</div>
                  </div>`
                : ""
            }
          </div>
          <label class="field">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${state.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                state.applySettings({ ...state.settings, gatewayUrl: v });
              }}
              placeholder="ws://127.0.0.1:18789"
            />
          </label>
          <label class="field">
            <span>${t("overview.access.token")}</span>
            <div class="login-gate__secret-row">
              <input
                type=${state.loginShowGatewayToken ? "text" : "password"}
                autocomplete="off"
                spellcheck="false"
                .value=${state.settings.token}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  state.applySettings({ ...state.settings, token: v });
                }}
                placeholder="OPENCLAW_GATEWAY_TOKEN (${t("login.passwordPlaceholder")})"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    state.connect();
                  }
                }}
              />
              <button
                type="button"
                class="btn btn--icon ${state.loginShowGatewayToken ? "active" : ""}"
                title=${state.loginShowGatewayToken ? "Hide token" : "Show token"}
                aria-label="Toggle token visibility"
                aria-pressed=${state.loginShowGatewayToken}
                @click=${() => {
                  state.loginShowGatewayToken = !state.loginShowGatewayToken;
                }}
              >
                ${state.loginShowGatewayToken ? icons.eye : icons.eyeOff}
              </button>
            </div>
          </label>
          <label class="field">
            <span>${t("overview.access.password")}</span>
            <div class="login-gate__secret-row">
              <input
                type=${state.loginShowGatewayPassword ? "text" : "password"}
                autocomplete="off"
                spellcheck="false"
                .value=${state.password}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  state.password = v;
                }}
                placeholder="${t("login.passwordPlaceholder")}"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    state.connect();
                  }
                }}
              />
              <button
                type="button"
                class="btn btn--icon ${state.loginShowGatewayPassword ? "active" : ""}"
                title=${state.loginShowGatewayPassword ? "Hide password" : "Show password"}
                aria-label="Toggle password visibility"
                aria-pressed=${state.loginShowGatewayPassword}
                @click=${() => {
                  state.loginShowGatewayPassword = !state.loginShowGatewayPassword;
                }}
              >
                ${state.loginShowGatewayPassword ? icons.eye : icons.eyeOff}
              </button>
            </div>
          </label>
          <button
            class="btn primary login-gate__connect"
            ?disabled=${!state.mockPortalUserId}
            @click=${() => state.connect()}
          >
            ${t("common.connect")}
          </button>
        </div>
        ${
          state.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
                <div>${state.lastError}</div>
              </div>`
            : ""
        }
        <div class="login-gate__help">
          <div class="login-gate__help-title">${t("overview.connection.title")}</div>
          <ol class="login-gate__steps">
            <li>${t("overview.connection.step1")}<code>openclaw gateway run</code></li>
            <li>${t("overview.connection.step2")}<code>openclaw dashboard --no-open</code></li>
            <li>${t("overview.connection.step3")}</li>
          </ol>
          <div class="login-gate__docs">
            <a
              class="session-link"
              href="https://docs.openclaw.ai/web/dashboard"
              target="_blank"
              rel="noreferrer"
            >${t("overview.connection.docsLink")}</a>
          </div>
        </div>
      </div>
    </div>
  `;
}
