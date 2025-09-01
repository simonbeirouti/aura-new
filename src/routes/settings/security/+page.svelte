<script lang="ts">
  import { onMount } from "svelte";
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { goto } from "$app/navigation";
  import {
    biometricActions,
    isBiometricAvailable,
    isBiometricEnabled,
  } from "$lib/stores/biometricStore";
  import { Switch } from "$lib/components/ui/switch";
  import { toast } from "svelte-sonner";

  onMount(async () => {
    // Initialize biometric store if not already done
    await biometricActions.initialize();
  });

  function goBack() {
    goto("/settings");
  }

  async function handleToggleBiometric() {
    if (!$isBiometricAvailable) {
      toast.error("Biometric authentication is not available on this device");
      return;
    }

    try {
      const newEnabled = !$isBiometricEnabled;
      await biometricActions.setEnabled(newEnabled, false); // Default to not requiring on startup

      if (newEnabled) {
        toast.success("Biometric authentication enabled");
      } else {
        toast.success("Biometric authentication disabled");
      }
    } catch (error) {
      toast.error("Failed to update biometric settings");
    }
  }
</script>

<AppLayout
  title="Security"
  showBackButton={true}
  onBack={goBack}
  maxWidth="max-w-2xl"
>
  <div class="flex items-center justify-between py-4 px-1">
    <h1 class="text-sm font-medium">Biometric Authentication</h1>
    <Switch
      checked={$isBiometricEnabled}
      disabled={!$isBiometricAvailable}
      onCheckedChange={handleToggleBiometric}
    />
  </div>
</AppLayout>
