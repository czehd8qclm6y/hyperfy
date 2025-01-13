import * as THREE from '../extras/three'

import { System } from './System'

import { hashFile } from '../utils-client'
import { hasRole, uuid } from '../utils'
import { ControlPriorities } from '../extras/ControlPriorities'
import { CopyIcon, EyeIcon, HandIcon, Trash2Icon, UnlinkIcon } from 'lucide-react'
import { cloneDeep } from 'lodash-es'

contextBreakers = ['MouseLeft', 'Escape']

/**
 * Editor System
 *
 * - runs on the client
 * - listens for files being drag and dropped onto the window and handles them
 * - handles editing apps
 *
 */
export class ClientEditor extends System {
  constructor(world) {
    super(world)
    this.target = null
    this.file = null
    this.contextTracker = {
      downAt: null,
      movement: new THREE.Vector3(),
    }
  }

  async init({ viewport, onContext, onApp }) {
    viewport.addEventListener('dragover', this.onDragOver)
    viewport.addEventListener('dragenter', this.onDragEnter)
    viewport.addEventListener('dragleave', this.onDragLeave)
    viewport.addEventListener('drop', this.onDrop)
    this.onContext = onContext
    this.onApp = onApp
  }

  start() {
    this.control = this.world.controls.bind({
      priority: ControlPriorities.EDITOR,
      onPress: code => {
        if (code === 'MouseRight') {
          this.contextTracker.downAt = performance.now()
          this.contextTracker.movement.set(0, 0, 0)
        }
      },
      onRelease: code => {
        if (code === 'MouseRight') {
          const elapsed = performance.now() - this.contextTracker.downAt
          const distance = this.contextTracker.movement.length()
          if (elapsed < 300 && distance < 30) {
            this.tryContext()
          }
        }
        if (this.context && contextBreakers.includes(code)) {
          this.setContext(null)
        }
      },
    })
  }

  update(delta) {
    if (this.control.buttons.MouseRight) {
      this.contextTracker.movement.add(this.control.pointer.delta)
    }
  }

  tryContext() {
    const hits = this.world.stage.raycastPointer(this.world.controls.pointer.position)
    let entity
    for (const hit of hits) {
      entity = hit.getEntity?.()
      if (entity) break
    }
    if (!entity) return
    const context = {
      id: uuid(),
      x: this.world.controls.pointer.position.x,
      y: this.world.controls.pointer.position.y,
      actions: [],
    }
    if (entity.isPlayer) {
      context.actions.push({
        label: 'Inspect',
        icon: EyeIcon,
        visible: true,
        disabled: false,
        onClick: () => {
          this.setContext(null)
        },
      })
    }
    if (entity.isApp) {
      const roles = this.world.entities.player.data.user.roles
      const isAdmin = hasRole(roles, 'admin')
      const isBuilder = hasRole(roles, 'builder')
      context.actions.push({
        label: 'Inspect',
        icon: EyeIcon,
        visible: isAdmin || isBuilder,
        disabled: false,
        onClick: () => {
          this.setContext(null)
          this.onApp(entity)
        },
      })
      context.actions.push({
        label: 'Move',
        icon: HandIcon,
        visible: isAdmin || isBuilder,
        disabled: false,
        onClick: () => {
          this.setContext(null)
          entity.move()
        },
      })
      context.actions.push({
        label: 'Duplicate',
        icon: CopyIcon,
        visible: isAdmin || isBuilder,
        disabled: !!entity.data.uploader, // must be uploaded
        onClick: () => {
          this.setContext(null)
          const data = {
            id: uuid(),
            type: 'app',
            blueprint: entity.data.blueprint,
            position: entity.data.position,
            quaternion: entity.data.quaternion,
            mover: this.world.network.id,
            uploader: null,
          }
          this.world.entities.add(data, true)
        },
      })
      context.actions.push({
        label: 'Unlink',
        icon: UnlinkIcon,
        visible: isAdmin || isBuilder,
        disabled: !!entity.data.uploader, // must be uploaded
        onClick: () => {
          this.setContext(null)
          // duplicate the blueprint
          const blueprint = {
            id: uuid(),
            version: 0,
            model: entity.blueprint.model,
            script: entity.blueprint.script,
            values: cloneDeep(entity.blueprint.values),
          }
          this.world.blueprints.add(blueprint, true)
          // assign new blueprint
          entity.modify({ blueprint: blueprint.id })
          this.world.network.send('entityModified', { id: entity.data.id, blueprint: blueprint.id })
        },
      })
      context.actions.push({
        label: 'Destroy',
        icon: Trash2Icon,
        visible: isAdmin || isBuilder,
        disabled: false,
        onClick: () => {
          this.setContext(null)
          entity.destroy(true)
        },
      })
    }
    if (context.actions.length) {
      this.setContext(context)
    }
  }

  setContext(value) {
    this.context = value
    this.onContext(value)
  }

  onDragOver = e => {
    e.preventDefault()
  }

  onDragEnter = e => {
    this.target = e.target
    this.dropping = true
    this.file = null
  }

  onDragLeave = e => {
    if (e.target === this.target) {
      this.dropping = false
    }
  }

  onDrop = e => {
    e.preventDefault()
    this.dropping = false
    // ensure we have admin/builder role
    const roles = this.world.entities.player.data.user.roles
    const canDrop = hasRole(roles, 'admin', 'builder')
    if (!canDrop) return
    // handle drop
    let file
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const item = e.dataTransfer.items[0]
      if (item.kind === 'file') {
        file = item.getAsFile()
      }
      if (item.type === 'text/uri-list') {
        // ...
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      file = e.dataTransfer.files[0]
    }
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (ext === 'glb') {
      this.addGLB(file)
    }
  }

  async addGLB(file) {
    // immutable hash the file
    const hash = await hashFile(file)
    // use hash as glb filename
    const filename = `${hash}.glb`
    // canonical url to this file
    const url = `asset://${filename}`
    // cache file locally so this client can insta-load it
    this.world.loader.insert('glb', url, file)
    // make blueprint
    const blueprint = {
      id: uuid(),
      version: 0,
      model: url,
      script: null,
      values: {},
    }
    // register blueprint
    this.world.blueprints.add(blueprint, true)
    // get spawn point
    const hit = this.world.stage.raycastPointer(this.control.pointer.position)[0]
    const position = hit ? hit.point.toArray() : [0, 0, 0]
    // spawn the app moving
    // - mover: follows this clients cursor until placed
    // - uploader: other clients see a loading indicator until its fully uploaded
    const data = {
      id: uuid(),
      type: 'app',
      blueprint: blueprint.id,
      position,
      quaternion: [0, 0, 0, 1],
      mover: this.world.network.id,
      uploader: this.world.network.id,
    }
    const app = this.world.entities.add(data, true)
    // upload the glb
    await this.world.network.upload(file)
    // mark as uploaded so other clients can load it in
    app.onUploaded()
  }
}
