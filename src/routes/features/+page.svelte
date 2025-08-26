<script lang="ts">
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { goto } from "$app/navigation";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";

  function goBack() {
    goto("/");
  }

  // Sample features data
  const features = [
    {
      id: 1,
      title: "Secure Authentication",
      description:
        "Enterprise-grade security with Supabase Auth, encrypted sessions, and secure token management.",
      icon: "🔐",
      status: "active",
      category: "Security",
    },
  ];

  function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
    switch (status) {
      case "active":
        return "default";
      case "coming-soon":
        return "secondary";
      case "development":
        return "outline";
      default:
        return "secondary";
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case "active":
        return "Active";
      case "coming-soon":
        return "Coming Soon";
      case "development":
        return "In Development";
      default:
        return "Unknown";
    }
  }
</script>

<AppLayout title="Features" showBackButton={true} onBack={goBack} maxWidth="max-w-4xl">

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each features as feature (feature.id)}
        <Card class="hover:shadow-lg transition-shadow duration-300">
          <CardHeader>
            <div class="flex items-start justify-between">
              <div class="text-4xl">{feature.icon}</div>
              <Badge variant={getStatusVariant(feature.status)}>
                {getStatusText(feature.status)}
              </Badge>
            </div>
            <CardTitle class="text-lg">{feature.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-muted-foreground text-sm mb-4">
              {feature.description}
            </p>
            
            <div class="flex justify-between items-center">
              <Badge variant="outline" class="text-xs">{feature.category}</Badge>
              <button
                class="px-3 py-1 text-sm rounded-md transition-colors {
                  feature.status === 'active' 
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90' 
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }"
                disabled={feature.status !== "active"}
              >
                {#if feature.status === "active"}
                  Try Now
                {:else}
                  Learn More
                {/if}
              </button>
            </div>
          </CardContent>
        </Card>
      {/each}
    </div>
</AppLayout>
