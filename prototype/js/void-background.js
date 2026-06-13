/**
 * Void background — darkness outward, water within, spirit hovering.
 * WebGL fragment shader: formless depth, not light from above.
 */

const canvas = document.getElementById("void");
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: false,
  powerPreference: "high-performance",
});

if (!gl) {
  console.warn("WebGL unavailable; void remains still.");
} else {
  initVoid(gl, canvas);
}

function initVoid(gl, canvas) {
  const vertSrc = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragSrc = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;

    // Simplex-style noise
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                          -0.577350269189626, 0.024390243902439);
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m;
      m = m * m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.853735352923257 * (a0 * a0 + h * h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
      for (int i = 0; i < 5; i++) {
        v += a * snoise(p);
        p = rot * p * 2.0 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;
      vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

      float t = u_time * 0.08;

      // Depth: darkness is not flat — layers recede into the void
      float depth = 1.0 - length(p * vec2(0.55, 0.75)) * 0.38;
      depth = clamp(depth, 0.0, 1.0);
      depth = pow(depth, 1.6);

      // Water currents — slow, submerged, moving within darkness
      vec2 flow = vec2(
        fbm(p * 1.1 + vec2(t * 0.3, t * 0.15)),
        fbm(p * 1.1 + vec2(4.2, 1.8) + vec2(-t * 0.22, t * 0.28))
      );
      vec2 warped = p + flow * 0.35;

      float water1 = fbm(warped * 0.9 + vec2(0.0, t * 0.4));
      float water2 = fbm(warped * 1.6 - vec2(t * 0.25, t * 0.18));
      float water3 = fbm(warped * 2.4 + vec2(t * 0.12, -t * 0.2));

      float currents = water1 * 0.5 + water2 * 0.32 + water3 * 0.18;
      currents = smoothstep(-0.2, 0.85, currents);

      // Emanate from darkness outward — subtle phosphorescence, never spotlight
      vec3 voidBase = vec3(0.004, 0.006, 0.014);
      vec3 deepWater = vec3(0.012, 0.028, 0.048);
      vec3 midDepth = vec3(0.018, 0.042, 0.062);
      vec3 surfaceHint = vec3(0.025, 0.055, 0.075);

      vec3 color = mix(voidBase, deepWater, depth * 0.6);
      color = mix(color, midDepth, currents * depth * 0.45);
      color += surfaceHint * currents * currents * depth * 0.12;

      // Underwater caustic whisper — light born inside the dark, not cast down
      float caustic = fbm(warped * 3.2 + vec2(t * 0.6, -t * 0.45));
      caustic *= fbm(warped * 5.0 - vec2(t * 0.35, t * 0.5));
      color += vec3(0.02, 0.05, 0.07) * caustic * caustic * depth * 0.35;

      // Hovering Spirit — formless luminescence suspended in the deep
      vec2 spiritPos = vec2(
        sin(t * 0.35) * 0.28 + sin(t * 0.11) * 0.12,
        cos(t * 0.28) * 0.22 + cos(t * 0.17) * 0.08 + 0.05
      );
      float spiritBreath = 0.85 + 0.15 * sin(t * 0.9);

      float dist = length(p - spiritPos);
      float spiritCore = exp(-dist * dist * (18.0 / spiritBreath));
      float spiritHalo = exp(-dist * 2.8) * 0.35;
      float spiritMist = fbm(p * 2.0 + spiritPos * 3.0 + t * 0.2) * exp(-dist * 1.6) * 0.25;

      vec3 spiritColor = vec3(0.06, 0.12, 0.18);
      vec3 spiritGlow = vec3(0.08, 0.16, 0.22);
      color += spiritColor * spiritCore * 0.55;
      color += spiritGlow * spiritHalo * 0.4;
      color += spiritGlow * spiritMist * 0.3;

      // Secondary distant spirit — faint companion presence
      vec2 spirit2 = vec2(-0.45, 0.3) + vec2(sin(t * 0.2) * 0.06, cos(t * 0.15) * 0.05);
      float dist2 = length(p - spirit2);
      color += vec3(0.03, 0.06, 0.1) * exp(-dist2 * dist2 * 28.0) * 0.25;

      // Vignette from edges inward — the void surrounds
      float vignette = 1.0 - length(p * vec2(0.65, 0.85)) * 0.42;
      vignette = smoothstep(0.0, 1.0, vignette);
      color *= mix(0.35, 1.0, vignette);

      // Keep everything submerged — crush highlights
      color = pow(color, vec3(1.15));
      color = clamp(color, 0.0, 0.22);

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const program = createProgram(gl, vertSrc, fragSrc);
  const positionLoc = gl.getAttribLocation(program, "a_position");
  const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
  const timeLoc = gl.getUniformLocation(program, "u_time");

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  resize();
  window.addEventListener("resize", resize);

  const start = performance.now();

  function frame(now) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
    gl.uniform1f(timeLoc, (now - start) * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function createProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}
