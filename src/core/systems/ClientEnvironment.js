import * as THREE from '../extras/three'

import { System } from './System'

import { CSM } from '../libs/csm/CSM'
import { glbToNodes } from '../extras/glbToNodes'

const csmLevels = {
  none: {
    cascades: 1,
    shadowMapSize: 1024,
    castShadow: false,
    lightIntensity: 3,
    // shadowBias: 0.000002,
    // shadowNormalBias: 0.001,
    shadowIntensity: 2,
  },
  low: {
    cascades: 1,
    shadowMapSize: 2048,
    castShadow: true,
    lightIntensity: 1,
    shadowBias: 0.0000009,
    shadowNormalBias: 0.001,
    shadowIntensity: 2,
  },
  med: {
    cascades: 3,
    shadowMapSize: 1024,
    castShadow: true,
    lightIntensity: 1,
    shadowBias: 0.000002,
    shadowNormalBias: 0.002,
    shadowIntensity: 2,
  },
  high: {
    cascades: 3,
    shadowMapSize: 2048,
    castShadow: true,
    lightIntensity: 1,
    shadowBias: 0.000003,
    shadowNormalBias: 0.002,
    shadowIntensity: 2,
  },
}

/**
 * Environment System
 *
 * - Runs on the client
 * - Sets up the sun, shadows, fog, skybox etc
 *
 */
export class ClientEnvironment extends System {
  constructor(world) {
    super(world)
  }

  async start() {
    this.buildHDR()
    this.buildCSM()
    this.buildFog()
    this.world.client.settings.on('change', this.onSettingsChange)
    this.world.graphics.on('resize', this.onViewportResize)

    // TEMP: base environment
    const glb = await this.world.loader.load('glb', '/base-environment.glb')
    const root = glbToNodes(glb, this.world)
    root.activate({ world: this.world, physics: true })

    // {
    //   // temp box
    //   const geometry = new THREE.TorusKnotGeometry(10, 3, 100, 20)
    //   const material = new THREE.MeshStandardMaterial({ color: 'red' })
    //   // const material = new THREE.MeshBasicMaterial({ color: 'red' })
    //   const mesh = new THREE.Mesh(geometry, material)
    //   mesh.position.z = -50
    //   this.world.stage.scene.add(mesh)
    //   this.foo = mesh
    // }
  }

  update(delta) {
    this.csm.update()
    // this.foo.rotation.y += 0.5 * delta
  }

  async buildHDR() {
    // const url = '/dusk3.hdr'
    const url = '/day2.hdr'
    const texture = await this.world.loader.load('hdr', url)
    // texture.colorSpace = THREE.NoColorSpace
    // texture.colorSpace = THREE.SRGBColorSpace
    // texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.mapping = THREE.EquirectangularReflectionMapping
    this.world.stage.scene.environment = texture
  }

  buildCSM() {
    if (this.csm) this.csm.dispose()
    const scene = this.world.stage.scene
    const camera = this.world.camera
    const options = csmLevels[this.world.client.settings.shadows]
    this.csm = new CSM({
      mode: 'practical', // uniform, logarithmic, practical, custom
      // mode: 'custom',
      // customSplitsCallback: function (cascadeCount, nearDistance, farDistance) {
      //   return [0.05, 0.2, 0.5]
      // },
      cascades: 3,
      shadowMapSize: 2048,
      maxFar: 100,
      lightIntensity: 1,
      lightDirection: new THREE.Vector3(-1, -2, -2).normalize(),
      fade: true,
      parent: scene,
      camera: camera,
      // note: you can play with bias in console like this:
      // var csm = world.graphics.csm
      // csm.shadowBias = 0.00001
      // csm.shadowNormalBias = 0.002
      // csm.updateFrustums()
      // shadowBias: 0.00001,
      // shadowNormalBias: 0.002,
      // lightNear: 0.0000001,
      // lightFar: 5000,
      // lightMargin: 200,
      // noLastCascadeCutOff: true,
      ...options,
      // note: you can test changes in console and then call csm.updateFrustrums() to debug
    })
    for (const light of this.csm.lights) {
      light.shadow.intensity = options.shadowIntensity
    }
    if (!options.castShadow) {
      for (const light of this.csm.lights) {
        light.castShadow = false
      }
    }
  }

  buildFog() {
    // ...
  }

  onSettingsChange = changes => {
    if (changes.shadows) {
      this.buildCSM()
    }
  }

  onViewportResize = () => {
    this.csm.updateFrustums()
  }
}
