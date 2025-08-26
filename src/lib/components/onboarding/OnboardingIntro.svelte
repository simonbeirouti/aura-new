<script lang="ts">
    import { UserIcon } from "lucide-svelte";
    import { Card, CardContent } from "../ui/card";
</script>

<!-- Image Section -->
<div class="mb-16">
    <Card class="w-48 h-48 bg-gradient-to-br from-primary to-secondary border-0 shadow-lg">
        <CardContent class="flex items-center justify-center h-full p-0">
            <UserIcon class="w-24 h-24 text-white" />
        </CardContent>
    </Card>
</div>

<!-- Text Content -->
<div class="text-center">
    <h1 class="text-3xl font-bold text-foreground mb-6">
        Welcome to Aura!
    </h1>
    <p class="text-lg text-muted-foreground leading-relaxed">
        Your secure, personal digital vault where you can
        safely store and manage your most important
        information.
    </p>
</div>
