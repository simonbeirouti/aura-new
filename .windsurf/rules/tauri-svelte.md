---
trigger: always_on
---

## 1. Modern Event Handling (Svelte 5)

**Use new event syntax** for better performance and consistency:

```svelte
<!-- ❌ Legacy -->
<button on:click={handler}>Click</button>
<form on:submit|preventDefault={submit}>

<!-- ✅ Svelte 5 -->
<button onclick={handler}>Click</button>
<form onsubmit={handleSubmit}>

<script>
  function handleSubmit(event) {
    event.preventDefault();
    // handle form
  }
</script>
```

## 2. Reactive Store Access

**Use `$store` syntax** instead of manual subscriptions:

```svelte
<!-- ❌ Legacy -->
<script>
  let authState = {};
  authStore.subscribe(state => authState = state);
</script>
{#if authState.isAuthenticated}

<!-- ✅ Svelte 5 -->
<script>
  import { authStore } from './stores/auth.js';
</script>
{#if $authStore.isAuthenticated}
```

## 3. Tauri Command Integration

**Proper async/await patterns** with error handling:

```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  
  async function handleTauriCommand() {
    try {
      const result = await invoke('command_name', { data });
      // Handle success
    } catch (error) {
      console.error('Command failed:', error);
    }
  }
</script>
```

## 4. TypeScript Integration

**Strong typing** for props and Tauri commands:

```svelte
<script lang="ts">
  interface User {
    id: string;
    name: string;
  }
  
  export let user: User;
  export let onUpdate: (user: User) => void = () => {};
</script>
```

## 5. Performance Optimization

**Use derived stores** for computed values:

```svelte
<script>
  import { derived } from 'svelte/store';
  
  const displayName = derived(
    [userStore, settingsStore],
    ([$user, $settings]) => 
      $settings.showFull ? $user.fullName : $user.firstName
  );
</script>

<h1>Welcome, {$displayName}!</h1>
```

## 6. Error Boundaries

**Comprehensive error handling** with user feedback:

```svelte
<script>
  let loading = false;
  let error = null;
  
  async function safeInvoke(command, args) {
    loading = true;
    error = null;
    try {
      return await invoke(command, args);
    } catch (err) {
      error = err.message;
      throw err;
    } finally {
      loading = false;
    }
  }
</script>

{#if error}
  <div class="alert alert-error">{error}</div>
{/if}
```

## 7. State Management

**Centralized stores** for app-wide state:

```js
// stores/auth.js
import { writable } from 'svelte/store';

export const authStore = writable({
  isAuthenticated: false,
  user: null,
  loading: true
});

export const authActions = {
  login: async (credentials) => {
    const result = await invoke('login', credentials);
    authStore.update(state => ({ ...state, ...result }));
  }
};
```

## 8. Component Architecture

**Separation of concerns** between UI and logic:

```svelte
<!-- Layout.svelte -->
<script>
  import { authStore } from '../stores/auth.js';
</script>

{#if $authStore.loading}
  <div class="loading">Loading...</div>
{:else if $authStore.isAuthenticated}
  <slot />
{:else}
  <LoginForm />
{/if}
```

## 9. Security Best Practices

**Input validation** and CSP configuration:

```json
// tauri.conf.json
{
  "tauri": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'"
    }
  }
}
```

```svelte
<script>
  function validateInput(value) {
    if (!value || value.trim().length === 0) {
      throw new Error('Input required');
    }
    return value.trim();
  }
</script>
```

## 10. Build Optimization

**Efficient bundling** and code splitting:

```svelte
<script>
  // Lazy load heavy components
  let HeavyComponent = null;
  
  async function loadComponent() {
    const module = await import('./HeavyComponent.svelte');
    HeavyComponent = module.default;
  }
</script>

{#if HeavyComponent}
  <svelte:component this={HeavyComponent} />
{/if}
```

## Migration Checklist

- [ ] Replace `on:*` with `on*` event handlers
- [ ] Convert store subscriptions to `$store` syntax  
- [ ] Add manual `preventDefault()` to form handlers
- [ ] Update TypeScript types for all props
- [ ] Test all Tauri command integrations
- [ ] Validate error handling patterns
- [ ] Check performance with reactive patterns

## Key Benefits

- **Performance**: Reduced bundle size, better reactivity
- **Developer Experience**: Improved TypeScript integration
- **Maintainability**: Cleaner code patterns
- **Security**: Better error handling and validation
- **Cross-platform**: Consistent behavior across platforms

## Resources

- [Svelte 5 Documentation](https://svelte.dev/)
- [Tauri Documentation](https://tauri.app/)
- [TypeScript + Svelte Guide](https://svelte.dev/docs/typescript)
