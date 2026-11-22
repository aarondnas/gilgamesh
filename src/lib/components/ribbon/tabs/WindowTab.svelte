<!-- The ribbon's Window: where the editor and the PDF are shown, the problems panel, the layout. -->
<script lang="ts">
  import Columns2 from "@lucide/svelte/icons/columns-2";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import PanelTop from "@lucide/svelte/icons/panel-top";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { m } from "$lib/paraglide/messages";
  import { build } from "$lib/state/build.svelte";
  import { PANES, panes, type PaneId } from "$lib/state/panes.svelte";
  import { project } from "$lib/state/project.svelte";
  import RibbonButton from "../RibbonButton.svelte";
  import RibbonGroup from "../RibbonGroup.svelte";

  const paneNames: Record<PaneId, () => string> = { editor: m.pane_editor, pdf: m.pane_pdf };
</script>

{#each PANES as id (id)}
  <RibbonGroup label={paneNames[id]()}>
    <div class="pair">
      <RibbonButton
        iconOnly
        icon={PanelTop}
        label={m.ribbon_pane_dock()}
        title={m.ribbon_pane_dock_title({ pane: paneNames[id]() })}
        active={panes.mode[id] === "docked"}
        onclick={() => panes.dock(id)}
      />
      <RibbonButton
        iconOnly
        icon={SquareArrowOutUpRight}
        label={m.ribbon_pane_detach()}
        title={m.ribbon_pane_detach_title({ pane: paneNames[id]() })}
        active={panes.mode[id] === "detached"}
        disabled={!project.root}
        onclick={() => panes.detach(id)}
      />
      <RibbonButton
        iconOnly
        icon={EyeOff}
        label={m.ribbon_pane_close()}
        title={m.ribbon_pane_close_title({ pane: paneNames[id]() })}
        active={panes.mode[id] === "closed"}
        onclick={() => panes.close(id)}
      />
    </div>
  </RibbonGroup>
{/each}
<RibbonGroup label={m.problems_title()}>
  <div class="pair">
    <RibbonButton
      iconOnly
      icon={Eye}
      label={m.ribbon_problems_show()}
      title={m.ribbon_problems_show_title()}
      active={build.problemsVisible}
      onclick={() => build.setProblemsPanel(true)}
    />
    <RibbonButton
      iconOnly
      icon={EyeOff}
      label={m.ribbon_problems_hide()}
      title={m.ribbon_problems_hide_title()}
      active={!build.problemsVisible}
      onclick={() => build.setProblemsPanel(false)}
    />
    <RibbonButton
      iconOnly
      icon={TriangleAlert}
      label={m.ribbon_problems_unignore()}
      title={m.ribbon_problems_unignore_title({ count: project.config.ignoredWarnings.length })}
      disabled={project.config.ignoredWarnings.length === 0}
      onclick={() => void build.showIgnoredWarnings()}
    />
  </div>
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_layout()}>
  <RibbonButton large icon={Columns2} label={m.pane_reset()} title={m.ribbon_pane_reset_title()} onclick={() => panes.reset()} />
</RibbonGroup>
