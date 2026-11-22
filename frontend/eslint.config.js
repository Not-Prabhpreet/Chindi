import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default ts.config(
  { ignores: ["dist/**", "node_modules/**", "public/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
    },
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        Blob: "readonly",
        fetch: "readonly",
        console: "readonly",
        localStorage: "readonly",
        crypto: "readonly",
        FormData: "readonly",
        Notification: "readonly",
        PushManager: "readonly",
        atob: "readonly",
        btoa: "readonly",
        HTMLInputElement: "readonly",
        HTMLFormElement: "readonly",
        HTMLElement: "readonly",
        HTMLSelectElement: "readonly",
        HTMLTextAreaElement: "readonly",
        Event: "readonly",
      },
    },
  },
);
