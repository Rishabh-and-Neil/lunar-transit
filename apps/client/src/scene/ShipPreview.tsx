import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ACESFilmicToneMapping, type Group } from "three";
import type { AttachmentId } from "@sm/shared";
import { VIEWER_COLOR } from "./constants";
import { StudioEnvironment } from "./SpaceScene";
import { ShipModel, createShipControl } from "./Spacecraft";

export interface ShipPreviewProps {
  attachments: AttachmentId[];
  hasRepairDrone: boolean;
  repairUpgraded?: boolean;
}

function Turntable(props: ShipPreviewProps) {
  const group = useRef<Group>(null);
  const control = useMemo(() => createShipControl(0.8), []);
  const wide = props.attachments.includes("solar-array");
  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y += Math.min(dt, 0.1) * 0.35;
    g.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.04;
    control.thrust = 0.75 + Math.sin(state.clock.elapsedTime * 1.3) * 0.15;
  });
  return (
    <group rotation={[0.18, 0, 0]} scale={wide ? 0.74 : 1.05}>
      <group ref={group} rotation={[0, -0.6, 0]}>
        <ShipModel
          attachments={props.attachments}
          hasRepairDrone={props.hasRepairDrone}
          repairUpgraded={props.repairUpgraded ?? false}
          accent={VIEWER_COLOR}
          control={control}
        />
      </group>
    </group>
  );
}

/** Small transparent turntable canvas for the equipment shop. Fills its parent container. */
export function ShipPreview(props: ShipPreviewProps) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 120 }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        camera={{ fov: 30, near: 0.05, far: 50, position: [2.1, 1.35, 2.7] }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0);
          gl.toneMapping = ACESFilmicToneMapping;
          camera.lookAt(0, 0.05, 0);
        }}
        style={{ position: "absolute", inset: 0, background: "transparent" }}
      >
        <StudioEnvironment intensity={0.9} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[3, 4, 2.5]} intensity={2.6} color="#fff4e6" />
        <directionalLight position={[-3, 1.2, -3]} intensity={1.8} color={VIEWER_COLOR} />
        <directionalLight position={[0, -3, 1]} intensity={0.4} color="#b49cff" />
        <Turntable {...props} />
      </Canvas>
    </div>
  );
}
