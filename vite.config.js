import { defineConfig, loadEnv } from "vite";

// Em desenvolvimento, serve as funções de /api com o mesmo código que roda na Vercel.
function localApi(env) {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use("/api/parse-receipt", async (req, res) => {
        Object.assign(process.env, env);
        const { default: handler } = await server.ssrLoadModule("/api/parse-receipt.js");
        await handler(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [localApi(env)] };
});
