<script lang="ts">
  import Scan from "@lucide/svelte/icons/scan";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import { m } from "$lib/paraglide/messages";
  import type { ImageZoom } from "$lib/state/image-zoom.svelte";
  import Button from "../ui/Button.svelte";
  import ZoomInput from "../ui/ZoomInput.svelte";

  interface Props {
    zoom: ImageZoom;
  }

  let { zoom }: Props = $props();
</script>

<Button variant="ghost" title={m.pdf_zoom_out()} disabled={zoom.value <= zoom.min} onclick={() => zoom.step(true)}>
  <ZoomOut size={15} />
</Button>
<ZoomInput value={zoom.value} min={zoom.min} max={zoom.max} onchange={(value) => zoom.set(value)} />
<Button variant="ghost" title={m.pdf_zoom_in()} disabled={zoom.value >= zoom.max} onclick={() => zoom.step(false)}>
  <ZoomIn size={15} />
</Button>
<Button variant="ghost" title={m.image_fit()} disabled={zoom.factor === null} onclick={() => zoom.reset()}>
  <Scan size={15} />
</Button>
