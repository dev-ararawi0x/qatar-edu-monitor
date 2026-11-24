import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <main>
      <h1>Qatar Education Monitor</h1>
      <p>Workspace scaffold ready.</p>
    </main>
  ),
});
