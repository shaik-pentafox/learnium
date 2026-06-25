import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { cn } from '@/lib/utils'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Layered "topographic paper" shader, recolored to the Traineon signature
 * gradient (indigo -> violet -> deep indigo). Reserved for brand moments
 * (login, score-reveal, empty states) per docs/DESIGN.md — never UI chrome.
 */
const fragmentShader = /* glsl */ `
  uniform float u_time;
  varying vec2 vUv;

  float random (in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm (in vec2 st, float time) {
    float value = 0.0;
    float amplitude = 0.5;
    float angle = 0.5 + time * 0.05;
    mat2 rot = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    for (int i = 0; i < 3; i++) {
      vec2 timeShift = vec2(cos(time * 0.2), sin(time * 0.3)) * float(i + 1);
      value += amplitude * noise(st + timeShift);
      st *= 2.0;
      st *= rot;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = vUv;
    float breathingScale = 1.3 + sin(u_time * 0.4) * 0.15;
    vec2 pos = uv * breathingScale;

    float n = fbm(pos, u_time);

    float numLayers = 6.0;
    float scaledN = n * numLayers;
    float layer = floor(scaledN);
    float fraction = fract(scaledN);

    // Traineon brand stops: indigo-400 -> deep violet.
    vec3 indigo = vec3(0.506, 0.549, 0.973); // #818cf8
    vec3 violet = vec3(0.545, 0.361, 0.965); // #8b5cf6
    vec3 deep   = vec3(0.121, 0.098, 0.345); // #1f1958

    float t = layer / (numLayers - 1.0);
    // Pass through violet in the middle of the ramp, settle into deep indigo.
    vec3 baseColor = mix(mix(indigo, violet, smoothstep(0.0, 0.6, t)), deep, smoothstep(0.5, 1.0, t));

    // Soft drop shadow on each paper step.
    float shadowIntensity = smoothstep(0.4, 0.0, fraction);
    shadowIntensity = pow(shadowIntensity, 1.8) * 0.14;
    vec3 finalColor = baseColor - vec3(shadowIntensity);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`

interface ShaderBackgroundProps {
  className?: string
}

export function ShaderBackground({ className }: ShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 1

    const uniforms = { u_time: { value: 0 } }
    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    function resize() {
      const { clientWidth, clientHeight } = container as HTMLDivElement
      renderer.setSize(clientWidth, clientHeight, false)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    const start = performance.now()
    let frameId = 0

    function renderFrame() {
      uniforms.u_time.value = (performance.now() - start) / 1000
      renderer.render(scene, camera)
    }

    if (prefersReducedMotion) {
      renderFrame()
    } else {
      const loop = () => {
        renderFrame()
        frameId = requestAnimationFrame(loop)
      }
      frameId = requestAnimationFrame(loop)
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 z-0', className)}
    />
  )
}
