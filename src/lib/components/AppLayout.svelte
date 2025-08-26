<script lang="ts">
  import PageWrapper from "./PageWrapper.svelte";
  
  export let title: string = "";
  export let showBackButton: boolean = false;
  export let maxWidth: string = "max-w-4xl";
  export let padding: string = "p-4";
  export let onBack: (() => void) | null = null;
</script>

<PageWrapper 
  {title} 
  {showBackButton} 
  {maxWidth} 
  {padding} 
  paddingBottom="pb-24"
  {onBack}
>
  <slot name="header-actions" slot="header-actions" />
  <slot />
</PageWrapper>
