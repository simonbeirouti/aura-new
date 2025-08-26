<script lang="ts">
  import { animate, stagger } from "animejs";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import AppLayout from "$lib/components/AppLayout.svelte";

  function playBounceAnimation() {
    animate(".bounce-target", {
      translateY: [-20, 0],
      duration: 600,
      easing: "easeOutBounce",
    });
  }

  function playRotationAnimation() {
    animate(".rotate-target", {
      rotate: "360deg",
      duration: 1000,
      easing: "easeInOutQuad",
    });
  }

  function playStaggerAnimation() {
    animate(".stagger-item", {
      scale: [0, 1],
      opacity: [0, 1],
      duration: 600,
      delay: stagger(100),
      easing: "easeOutBack",
    });
  }

  function playPathAnimation() {
    animate(".path-target", {
      translateX: [0, 200],
      translateY: [0, -100, 0],
      rotate: [0, 180, 360],
      duration: 2000,
      easing: "easeInOutSine",
      loop: true,
      direction: "alternate",
    });
  }

  function playTimeline() {
    // Simple, working timeline animation
    animate(".hero-title", {
      opacity: [0, 1],
      scale: [0.75, 1],
      duration: 1000,
      easing: "easeOutQuad",
    });

    animate(".hero-subtitle", {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 800,
      delay: 400,
      easing: "easeOutQuad",
    });

    // Animate the progress bar
    animate(".timeline-progress", {
      width: ["0%", "100%"],
      duration: 1400, // Slightly longer than the text animations
      easing: "easeOutQuad",
    });
  }
</script>

<svelte:head>
  <title>Anime.js Testing - Aura</title>
</svelte:head>

<AppLayout maxWidth="max-w-6xl">
  <!-- Animation Cards Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    <!-- Bounce Card -->
    <Card
      class="border-border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md"
    >
      <CardHeader>
        <CardTitle class="text-center">Bounce Effect</CardTitle>
      </CardHeader>
      <CardContent class="text-center">
        <div
          class="bounce-target w-20 h-20 bg-primary rounded-full mx-auto flex items-center justify-center text-primary-foreground text-2xl shadow-lg"
        >
          🎯
        </div>
        <p class="mt-4 text-sm text-muted-foreground">
          Click the bounce button to see this element bounce!
        </p>
        <Button class="mt-4" onclick={playBounceAnimation}>🎯 Bounce</Button>
      </CardContent>
    </Card>

    <!-- Rotation Card -->
    <Card
      class="border-border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md"
    >
      <CardHeader>
        <CardTitle class="text-center">Rotation</CardTitle>
      </CardHeader>
      <CardContent class="text-center">
        <div
          class="rotate-target w-20 h-20 bg-secondary rounded-lg mx-auto flex items-center justify-center text-secondary-foreground text-2xl shadow-lg"
        >
          🔄
        </div>
        <p class="mt-4 text-sm text-muted-foreground">
          Click rotation to spin this element!
        </p>
        <Button
          class="mt-4"
          variant="secondary"
          onclick={playRotationAnimation}
        >
          🔄 Rotate
        </Button>
      </CardContent>
    </Card>

    <!-- Stagger Card -->
    <Card
      class="border-border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md"
    >
      <CardHeader>
        <CardTitle class="text-center">Stagger Effect</CardTitle>
      </CardHeader>
      <CardContent class="text-center">
        <div class="flex justify-center gap-2">
          <div
            class="stagger-item w-8 h-8 bg-accent rounded-full flex items-center justify-center text-accent-foreground text-xs shadow-sm"
          >
            1
          </div>
          <div
            class="stagger-item w-8 h-8 bg-accent rounded-full flex items-center justify-center text-accent-foreground text-xs shadow-sm"
          >
            2
          </div>
          <div
            class="stagger-item w-8 h-8 bg-accent rounded-full flex items-center justify-center text-accent-foreground text-xs shadow-sm"
          >
            3
          </div>
          <div
            class="stagger-item w-8 h-8 bg-accent rounded-full flex items-center justify-center text-accent-foreground text-xs shadow-sm"
          >
            4
          </div>
        </div>
        <p class="mt-4 text-sm text-muted-foreground">
          Watch them appear one by one!
        </p>
        <Button class="mt-4" variant="outline" onclick={playStaggerAnimation}>
          ⚡ Stagger
        </Button>
      </CardContent>
    </Card>

    <!-- Path Animation Card -->
    <Card
      class="border-border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md"
    >
      <CardHeader>
        <CardTitle class="text-center">Path Animation</CardTitle>
      </CardHeader>
      <CardContent class="text-center">
        <div
          class="relative h-32 bg-muted rounded-lg overflow-hidden border border-border"
        >
          <div
            class="path-target w-8 h-8 bg-destructive rounded-full absolute top-1/2 left-4 transform -translate-y-1/2 shadow-lg"
          >
            🚀
          </div>
        </div>
        <p class="mt-4 text-sm text-muted-foreground">
          This element follows a custom path!
        </p>
        <Button class="mt-4" variant="destructive" onclick={playPathAnimation}>
          🛤️ Animate Path
        </Button>
      </CardContent>
    </Card>

    <!-- Timeline Card -->
    <Card
      class="border-border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md"
    >
      <CardHeader>
        <CardTitle class="text-center">Timeline</CardTitle>
      </CardHeader>
      <CardContent class="text-center">
        <div class="space-y-2">
          <div
            class="w-full h-3 bg-muted rounded-full overflow-hidden border border-border"
          >
            <div
              class="timeline-progress h-full bg-primary rounded-full"
              style="width: 0%"
            ></div>
          </div>
        </div>
        <div
          class="hero-subtitle opacity-0 translate-y-2 text-sm text-muted-foreground transform transition-all"
        >
          Watch the coordinated animation
        </div>
        <Button class="mt-4" onclick={playTimeline} variant="outline" size="sm">
          🎬 Play Timeline
        </Button>
      </CardContent>
    </Card>

    <!-- Interactive Demo Section -->
    <Card
      class="border-border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md"
    >
      <CardHeader>
        <CardTitle class="text-center">Interactive Demo</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-center space-y-4">
          <p class="text-muted-foreground">
            Try clicking this element to trigger an animation:
          </p>
          <Button
            class="w-24 h-24 mx-auto"
            variant="outline"
            onclick={(event) => {
              if (event.target) {
                animate(event.target, {
                  scale: [1, 1.2, 1],
                  rotate: [0, 10, -10, 0],
                  duration: 600,
                  easing: "easeInOutQuad",
                });
              }
            }}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (event.target) {
                  animate(event.target, {
                    scale: [1, 1.2, 1],
                    rotate: [0, 10, -10, 0],
                    duration: 600,
                    easing: "easeInOutQuad",
                  });
                }
              }
            }}
            aria-label="Click to trigger animation"
            type="button"
          >
            <div
              class="w-full h-full flex items-center justify-center text-3xl"
            >
              🎮
            </div>
          </Button>
          <p class="text-sm text-muted-foreground">
            Click to trigger a quick animation!
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
</AppLayout>

<style>
  /* Custom styles for better animation performance */
  .bounce-target,
  .rotate-target,
  .stagger-item,
  .path-target,
  .hero-subtitle {
    will-change: transform;
  }
</style>
