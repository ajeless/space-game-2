import {
  clearPlotDraftWeaponIntent,
  setPlotDraftStationKeeping,
  setPlotDraftWeaponTarget,
  type MatchSessionView,
  type PlotDraft,
  type PlotDraftSummary,
  type SystemId,
  type TacticalZoomPresetId
} from "../shared/index.js";

export type TacticalDragHandleId = "thrust" | "heading";

export function bindRenderedBridgeControls(input: {
  root: ParentNode;
  sessionValue: MatchSessionView | null;
  plotSummary: PlotDraftSummary | null;
  selectedMountId: SystemId | null;
  onUpdatePlotDraft: (mutator: (draft: PlotDraft) => PlotDraft) => void;
  onToggleSystemSelection: (systemId: SystemId) => void;
  onClearSystemSelection: () => void;
  onStartTacticalDrag: (
    handleId: TacticalDragHandleId,
    pointerId: number,
    clientX: number,
    clientY: number
  ) => void;
  onSetCameraZoom: (zoomPresetId: TacticalZoomPresetId) => void;
  onResetPlot: () => void;
  onResetSession: () => void | Promise<void>;
  onSetHostToolsOpen: (isOpen: boolean) => void;
  onClaimSlot: (slotId: string) => void;
  onSubmitPlot: () => void;
}): void {
  const {
    root,
    sessionValue,
    plotSummary,
    selectedMountId,
    onUpdatePlotDraft,
    onToggleSystemSelection,
    onClearSystemSelection,
    onStartTacticalDrag,
    onSetCameraZoom,
    onResetPlot,
    onResetSession,
    onSetHostToolsOpen,
    onClaimSlot,
    onSubmitPlot
  } = input;

  root.querySelector<HTMLInputElement>("[data-plot-heading]")?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;

    onUpdatePlotDraft((draft) => ({
      ...draft,
      heading_delta_degrees: Number.parseFloat(target.value)
    }));
  });

  root.querySelector<HTMLInputElement>("[data-plot-axial]")?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;

    onUpdatePlotDraft((draft) => ({
      ...draft,
      thrust_input: {
        ...draft.thrust_input,
        axial_fraction: Number.parseFloat(target.value) / 100
      }
    }));
  });

  root.querySelector<HTMLInputElement>("[data-plot-lateral]")?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;

    onUpdatePlotDraft((draft) => ({
      ...draft,
      thrust_input: {
        ...draft.thrust_input,
        lateral_fraction: Number.parseFloat(target.value) / 100
      }
    }));
  });

  root.querySelectorAll<SVGElement>("[data-select-system]").forEach((element) => {
    element.addEventListener("click", () => {
      const systemId = element.getAttribute("data-select-system");

      if (!systemId) {
        return;
      }

      onToggleSystemSelection(systemId);
    });
  });

  root.querySelector<HTMLButtonElement>("[data-clear-system-selection]")?.addEventListener("click", () => {
    onClearSystemSelection();
  });

  root.querySelectorAll<HTMLSelectElement>("[data-aim-charge]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const mountId = target.dataset.aimCharge;

      if (!mountId) {
        return;
      }

      onUpdatePlotDraft((draft) => ({
        ...draft,
        weapons: draft.weapons.map((weapon) =>
          weapon.mount_id === mountId ? { ...weapon, charge_pips: Number.parseInt(target.value, 10) } : weapon
        )
      }));
    });
  });

  root.querySelectorAll<SVGElement>("[data-target-ship]").forEach((element) => {
    element.addEventListener("click", () => {
      const targetShipId = element.getAttribute("data-target-ship");
      const currentWeapon = plotSummary?.draft.weapons.find((weapon) => weapon.mount_id === selectedMountId);

      if (!sessionValue || !targetShipId || !selectedMountId) {
        return;
      }

      onUpdatePlotDraft((draft) =>
        currentWeapon?.target_ship_instance_id === targetShipId
          ? clearPlotDraftWeaponIntent(sessionValue.battle_state, draft, selectedMountId)
          : setPlotDraftWeaponTarget(sessionValue.battle_state, draft, selectedMountId, targetShipId)
      );
    });
  });

  root.querySelector<HTMLButtonElement>("[data-clear-aim-target]")?.addEventListener("click", (event) => {
    const target = event.currentTarget as HTMLButtonElement;
    const mountId = target.dataset.clearAimTarget;

    if (!sessionValue || !mountId) {
      return;
    }

    onUpdatePlotDraft((draft) => clearPlotDraftWeaponIntent(sessionValue.battle_state, draft, mountId));
  });

  root.querySelectorAll<SVGElement>("[data-plot-drag-handle]").forEach((element) => {
    element.addEventListener("pointerdown", (event) => {
      const handleId = element.getAttribute("data-plot-drag-handle") as TacticalDragHandleId | null;

      if (!handleId) {
        return;
      }

      event.preventDefault();
      onStartTacticalDrag(handleId, event.pointerId, event.clientX, event.clientY);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-camera-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const zoomPresetId = button.dataset.cameraZoom as TacticalZoomPresetId | undefined;

      if (!zoomPresetId) {
        return;
      }

      onSetCameraZoom(zoomPresetId);
    });
  });

  root.querySelector<HTMLButtonElement>("[data-reset-plot]")?.addEventListener("click", () => {
    onResetPlot();
  });

  root.querySelector<HTMLButtonElement>("[data-station-keep]")?.addEventListener("click", () => {
    if (!sessionValue) {
      return;
    }

    onUpdatePlotDraft((draft) => setPlotDraftStationKeeping(sessionValue.battle_state, draft));
  });

  root.querySelector<HTMLButtonElement>("[data-reset-session]")?.addEventListener("click", () => {
    void onResetSession();
  });

  root.querySelector<HTMLDetailsElement>("[data-host-tools]")?.addEventListener("toggle", (event) => {
    onSetHostToolsOpen((event.currentTarget as HTMLDetailsElement).open);
  });

  root.querySelectorAll<HTMLButtonElement>("[data-claim-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      const slotId = button.dataset.claimSlot;

      if (!slotId) {
        return;
      }

      onClaimSlot(slotId);
    });
  });

  root.querySelector<HTMLButtonElement>("[data-submit-plot]")?.addEventListener("click", () => {
    onSubmitPlot();
  });
}
