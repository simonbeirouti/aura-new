<script>
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { derived } from "svelte/store";
  import { 
    HomeIcon, 
    SettingsIcon, 
    PlayIcon, 
    PackagePlusIcon
  } from "lucide-svelte";

  const navItems = [
    {
      path: "/",
      label: "Home",
      icon: HomeIcon,
      activePattern: /^\/$/
    },
    {
      path: "/features",
      label: "Features",
      icon: PlayIcon,
      activePattern: /^\/features/
    },
    {
      path: "/packages",
      label: "Packages",
      icon: PackagePlusIcon,
      activePattern: /^\/packages/
    },
    {
      path: "/settings",
      label: "Settings",
      icon: SettingsIcon,
      activePattern: /^\/settings/
    }
  ];

  // Use derived store for guaranteed reactivity
  const activeStates = derived(page, ($page) => {
    const currentPath = $page.url.pathname;
    return navItems.map(item => {
      if (item.activePattern) {
        return item.activePattern.test(currentPath);
      }
      return currentPath === item.path;
    });
  });

  // @ts-ignore
  function navigateTo(path) {
    goto(path);
  }
</script>

<footer class="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border" style="height: 4rem; min-height: 4rem; max-height: 4rem; flex-shrink: 0;">
  <nav class="flex items-center justify-around" style="height: 4rem; min-height: 4rem; max-height: 4rem; max-width: 28rem; margin: 0 auto; padding: 0 1rem;">
    {#each navItems as item, index}
      {@const active = $activeStates[index]}
      <button
        onclick={() => navigateTo(item.path)}
        class="flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors min-w-0 flex-1
               {active 
                 ? 'text-primary bg-primary/10' 
                 : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
               }"
        aria-label={item.label}
      >
        <svelte:component 
          this={item.icon} 
          class="w-5 h-5 {active ? 'stroke-2' : 'stroke-1.5'}" 
        />
        <span class="text-xs font-medium truncate">{item.label}</span>
      </button>
    {/each}
  </nav>
</footer>

<style>
  /* Ensure footer stays above other content and NEVER changes size */
  footer {
    box-shadow: 0 -1px 3px 0 rgb(0 0 0 / 0.1), 0 -1px 2px -1px rgb(0 0 0 / 0.1);
    height: 4rem !important;
    min-height: 4rem !important;
    max-height: 4rem !important;
    flex-shrink: 0 !important;
    flex-grow: 0 !important;
    flex-basis: 4rem !important;
  }
  
  nav {
    height: 4rem !important;
    min-height: 4rem !important;
    max-height: 4rem !important;
    flex-shrink: 0 !important;
    flex-grow: 0 !important;
  }
</style>
