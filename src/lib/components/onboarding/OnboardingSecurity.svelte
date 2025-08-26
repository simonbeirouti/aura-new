<script lang="ts">
    import { CheckIcon } from "lucide-svelte";
    import { Card, CardContent } from "../ui/card";
</script>

<!-- Image Section -->
<div class="mb-16">
    <Card class="w-48 h-48 bg-gradient-to-br from-primary to-secondary border-0 shadow-lg">
        <CardContent class="flex items-center justify-center h-full p-0">
            <CheckIcon class="w-24 h-24 text-white" />
        </CardContent>
    </Card>
</div>

<!-- Text Content -->
<div class="text-center">
    <h2 class="text-3xl font-bold text-foreground mb-6">
        Secure & Private
    </h2>
    <p class="text-lg text-muted-foreground leading-relaxed">
        Your data is encrypted and stored securely. Only you
        have access to your information.
    </p>
</div>
