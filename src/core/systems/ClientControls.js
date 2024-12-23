import { bindRotations } from '../extras/bindRotations'
import * as THREE from '../extras/three'
import { System } from './System'

const LMB = 1 // bitmask
const RMB = 2 // bitmask
const LMB_CODE = 'MouseLeft'
const RMB_CODE = 'MouseRight'

/**
 * Control System
 *
 * - runs on the client
 * - provides a layered priority control system for both input and output
 *
 */
export class ClientControls extends System {
  constructor(world) {
    super(world)
    this.controls = []
    this.isUserGesture = false
    this.pointer = {
      locked: false,
      shouldLock: false,
      coords: new THREE.Vector3(), // [0,0] to [1,1]
      position: new THREE.Vector3(), // [0,0] to [viewportWidth,viewportHeight]
      delta: new THREE.Vector3(), // position delta (pixels)
    }
    this.scroll = {
      delta: 0,
    }
  }

  preFixedUpdate() {
    // pointer
    for (const control of this.controls) {
      control.api.pointer.coords.copy(this.pointer.coords)
      control.api.pointer.position.copy(this.pointer.position)
      control.api.pointer.delta.copy(this.pointer.delta)
      control.api.pointer.locked = this.pointer.locked
      const consume = control.options.onPointer?.()
      if (consume) break
    }
    // scroll
    for (const control of this.controls) {
      control.api.scroll.delta = this.scroll.delta
      const consume = control.options.onScroll?.()
      if (consume) break
    }
  }

  postLateUpdate() {
    // clear pointer delta
    this.pointer.delta.set(0, 0, 0)
    // clear scroll delta
    this.scroll.delta = 0
    for (const control of this.controls) {
      // clear buttons
      control.api.pressed = {}
      control.api.released = {}
      // update camera
      if (control.api.camera.claimed) {
        this.world.rig.position.copy(control.api.camera.position)
        this.world.rig.quaternion.copy(control.api.camera.quaternion)
        this.world.camera.position.z = control.api.camera.zoom
        break
      }
    }
  }

  async init({ viewport }) {
    this.viewport = viewport
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    this.viewport.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    this.viewport.addEventListener('pointerup', this.onPointerUp)
    this.viewport.addEventListener('wheel', this.onScroll, { passive: false }) // prettier-ignore
    this.viewport.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('blur', this.onBlur)
  }

  bind(options = {}) {
    const control = {
      options,
      api: {
        buttons: {},
        pressed: {},
        released: {},
        pointer: {
          coords: new THREE.Vector3(), // [0,0] to [1,1]
          position: new THREE.Vector3(), // [0,0] to [viewportWidth,viewportHeight]
          delta: new THREE.Vector3(), // position delta (pixels)
          locked: false,
          lock: () => {
            this.lockPointer()
          },
          unlock: () => {
            this.unlockPointer()
          },
        },
        scroll: {
          delta: 0,
        },
        camera: {
          position: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
          zoom: 0,
          claimed: false,
          claim: () => {
            control.api.camera.claimed = true
          },
          unclaim: () => {
            control.api.camera.claimed = false
          },
        },
        release: () => {
          const idx = this.controls.indexOf(control)
          if (idx === -1) return
          this.controls.splice(idx, 1)
          control.options.onRelease?.()
        },
      },
    }
    bindRotations(control.api.camera.quaternion, control.api.camera.rotation)
    // insert at correct priority level
    // - 0 is lowest priority generally for player controls
    // - apps use higher priority
    // - global systems use highest priority over everything
    const idx = this.controls.findIndex(c => c.options.priority < options.priority)
    if (idx === -1) {
      this.controls.push(control)
    } else {
      this.controls.splice(idx, 0, control)
    }
    return control.api
  }

  releaseAllButtons() {
    // release all down buttons because they can get stuck
    for (const control of this.controls) {
      Object.keys(control.api.buttons).forEach(code => {
        control.api.buttons[code] = false
        control.api.released[code] = true
        control.options.onRelease?.(code)
      })
    }
  }

  onKeyDown = e => {
    if (e.repeat) return
    if (this.isInputFocused()) return
    const code = e.code
    for (const control of this.controls) {
      control.api.buttons[code] = true
      control.api.pressed[code] = true
      const consume = control.options.onPress?.(code)
      if (consume) break
    }
  }

  onKeyUp = e => {
    if (e.repeat) return
    if (this.isInputFocused()) return
    const code = e.code
    if (code === 'MetaLeft' || code === 'MetaRight') {
      // releasing a meta key while another key is down causes browsers not to ever
      // trigger onKeyUp, so we just have to force all keys up
      return this.releaseAllButtons()
    }
    for (const control of this.controls) {
      control.api.buttons[code] = false
      control.api.released[code] = true
      const consume = control.options.onRelease?.(code)
      if (consume) break
    }
  }

  onPointerDown = e => {
    this.checkPointerChanges(e)
  }

  onPointerMove = e => {
    this.checkPointerChanges(e)
    const rect = this.viewport.getBoundingClientRect()
    const offsetX = e.pageX - rect.left
    const offsetY = e.pageY - rect.top
    this.pointer.coords.x = Math.max(0, Math.min(1, offsetX / rect.width)) // prettier-ignore
    this.pointer.coords.y = Math.max(0, Math.min(1, offsetY / rect.height)) // prettier-ignore
    this.pointer.position.x = offsetX
    this.pointer.position.y = offsetY
    this.pointer.delta.x += e.movementX
    this.pointer.delta.y += e.movementY
  }

  onPointerUp = e => {
    this.checkPointerChanges(e)
  }

  checkPointerChanges(e) {
    const lmb = !!(e.buttons & LMB)
    // left mouse down
    if (!this.lmbDown && lmb) {
      this.lmbDown = true
      for (const control of this.controls) {
        control.api.buttons[LMB_CODE] = true
        control.api.pressed[LMB_CODE] = true
        const consume = control.options.onPress?.(LMB_CODE)
        if (consume) break
      }
    }
    // left mouse up
    if (this.lmbDown && !lmb) {
      this.lmbDown = false
      for (const control of this.controls) {
        control.api.buttons[LMB_CODE] = false
        control.api.released[LMB_CODE] = true
        const consume = control.options.onRelease?.(LMB_CODE)
        if (consume) break
      }
    }
    const rmb = !!(e.buttons & RMB)
    // right mouse down
    if (!this.rmbDown && rmb) {
      this.rmbDown = true
      for (const control of this.controls) {
        control.api.buttons[RMB_CODE] = true
        control.api.pressed[RMB_CODE] = true
        const consume = control.options.onPress?.(RMB_CODE)
        if (consume) break
      }
    }
    // right mouse up
    if (this.rmbDown && !rmb) {
      this.rmbDown = false
      for (const control of this.controls) {
        control.api.buttons[RMB_CODE] = false
        control.api.released[RMB_CODE] = true
        const consume = control.options.onRelease?.(RMB_CODE)
        if (consume) break
      }
    }
  }

  async lockPointer() {
    this.pointer.shouldLock = true
    try {
      await this.viewport.requestPointerLock()
      return true
    } catch (err) {
      // console.log('pointerlock denied, too quick?')
      return false
    }
  }

  unlockPointer() {
    this.pointer.shouldLock = false
    if (!this.pointer.locked) return
    document.exitPointerLock()
    this.onPointerLockEnd()
  }

  onPointerLockChange = e => {
    const didPointerLock = !!document.pointerLockElement
    if (didPointerLock) {
      this.onPointerLockStart()
    } else {
      this.onPointerLockEnd()
    }
  }

  onPointerLockStart() {
    if (this.pointer.locked) return
    this.pointer.locked = true
    // pointerlock is async so if its no longer meant to be locked, exit
    if (!this.pointer.shouldLock) this.unlockPointer()
  }

  onPointerLockEnd() {
    if (!this.pointer.locked) return
    this.pointer.locked = false
  }

  onScroll = e => {
    e.preventDefault()
    const delta = e.shiftKey ? e.deltaX : e.deltaY
    this.scroll.delta += delta
  }

  onContextMenu = e => {
    e.preventDefault()
  }

  onBlur = () => {
    this.releaseAllButtons()
  }

  isInputFocused() {
    return document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA'
  }
}
