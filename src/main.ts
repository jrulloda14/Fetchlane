// Entry point: design-system styles first, then app overrides.
import "../assets/fetchlane/design-system/tokens.css";
import "../assets/fetchlane/design-system/components/bundle.css";
import "./app.css";

async function boot() {
  // `npm run dev` in a plain browser: use sample data instead of the
  // backend. Stripped from production builds.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    (await import("./dev/preview")).installPreview();
  }
  const { start } = await import("./app");
  await start(document.getElementById("app")!);
}

void boot();
