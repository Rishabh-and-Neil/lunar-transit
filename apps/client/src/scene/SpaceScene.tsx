import { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, PMREMGenerator, SRGBColorSpace } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CameraRig, type SceneVariant } from "./CameraRig";
import { SUN_DIR } from "./constants";
import { Earth } from "./Earth";
import { EventDirector } from "./EventDirector";
import { Fleet } from "./Fleet";
import { Moon } from "./Moon";
import { Starfield } from "./Starfield";
import { Trajectory } from "./Trajectory";
export { warmSceneTextures } from "./textures";

export interface SpaceSceneProps {
  variant: SceneVariant;
}

/** Dim procedural environment map so metallic ship parts have something to reflect. */
export function StudioEnvironment({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    room.dispose();
    return () => {
      if (scene.environment === env) scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

function SceneContents({ variant }: SpaceSceneProps) {
  const sunPos: [number, number, number] = [SUN_DIR.x * 120, SUN_DIR.y * 120, SUN_DIR.z * 120];
  return (
    <>
      <StudioEnvironment intensity={0.22} />
      <ambientLight intensity={0.05} color="#8fa6ff" />
      <directionalLight position={sunPos} intensity={3.2} color="#fff3e2" />
      <directionalLight position={[40, -10, 30]} intensity={0.35} color="#4f7dff" />
      <hemisphereLight args={["#9fb8ff", "#1a1020", 0.12]} />
      <Starfield />
      <Earth />
      <Moon orbitOpacity={variant === "menu" ? 0.25 : 0.5} />
      <Trajectory opacity={variant === "menu" ? 0.4 : variant === "arrival" ? 0.65 : 1} followViewer={variant !== "menu"} />
      {variant !== "menu" && <Fleet />}
      {variant !== "menu" && <EventDirector />}
      <CameraRig variant={variant} />
    </>
  );
}

/** Full-viewport cinematic Earth–Moon scene. The HUD overlays it (z-index 0). */
export function SpaceScene({ variant }: SpaceSceneProps) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0, background: "#02030a" }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
        camera={{ fov: 38, near: 0.05, far: 4000, position: [18, 30, 40] }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = SRGBColorSpace;
        }}
      >
        <color attach="background" args={["#02030a"]} />
        <Suspense fallback={null}>
          <SceneContents variant={variant} />
        </Suspense>
      </Canvas>
    </div>
  );
}
