import { createFileRoute } from "@tanstack/react-router";

import { InstagramShell } from "@/components/InstagramShell";

export const Route = createFileRoute("/discover-users")({
  head: () => ({
    meta: [
      { title: "Discover Readers — Reading Corner" },
      {
        name: "description",
        content:
          "Discover registered Reading Corner users, follow profiles, and start conversations.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DiscoverUsersRoute,
});

function DiscoverUsersRoute() {
  return <InstagramShell initialTab="discover" />;
}
