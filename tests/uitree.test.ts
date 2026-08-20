import { describe, expect, it } from 'vitest'
import { center, findNodes, flatten, pickTapTarget, type UiNode } from '../src/uitree.ts'

const tree: UiNode = {
  class: 'android.widget.FrameLayout',
  bounds: { left: 0, top: 0, right: 1080, bottom: 1920 },
  children: [
    {
      class: 'android.widget.LinearLayout',
      bounds: { left: 0, top: 0, right: 1080, bottom: 300 },
      children: [
        {
          class: 'android.widget.TextView',
          text: 'Login',
          bounds: { left: 100, top: 100, right: 200, bottom: 150 },
        },
        {
          class: 'android.widget.Button',
          resourceId: 'com.demo:id/btn_login',
          text: '登录',
          clickable: true,
          bounds: { left: 100, top: 200, right: 300, bottom: 260 },
        },
        {
          class: 'android.widget.EditText',
          resourceId: 'com.demo:id/input_user',
          text: '用户名',
          bounds: { left: 50, top: 300, right: 500, bottom: 360 },
        },
      ],
    },
    {
      class: 'android.widget.Button',
      resourceId: 'com.demo:id/btn_hidden',
      text: 'hidden',
      visible: false,
      clickable: true,
      bounds: { left: 0, top: 0, right: 10, bottom: 10 },
    },
  ],
}

describe('uitree', () => {
  it('flattens the tree in order', () => {
    const all = flatten(tree)
    expect(all).toHaveLength(6)
    expect(all[0].class).toBe('android.widget.FrameLayout')
    expect(all[all.length - 1].resourceId).toBe('com.demo:id/btn_hidden')
  })

  it('finds nodes by text (case-insensitive, includes contentDescription)', () => {
    const login = findNodes(tree, { contains: 'login' })
    expect(login).toHaveLength(1)
    expect(login[0].text).toBe('Login')
  })

  it('finds nodes by resourceId suffix', () => {
    const btn = findNodes(tree, { resourceId: 'btn_login' })
    expect(btn).toHaveLength(1)
    expect(btn[0].text).toBe('登录')
  })

  it('skips invisible nodes and respects inside-rect', () => {
    expect(findNodes(tree, { contains: 'hidden' })).toHaveLength(0)
    const below = findNodes(tree, { contains: '登录', inside: { left: 0, top: 500, right: 1080, bottom: 1920 } })
    expect(below).toHaveLength(0)
  })

  it('computes the center point', () => {
    expect(center(tree.children![0].children![1])).toEqual({ x: 200, y: 230 })
  })

  it('picks a clickable target first', () => {
    const all = findNodes(tree, { contains: '' })
    // empty filter returns everything visible
    const target = pickTapTarget(all)
    expect(target?.resourceId).toBe('com.demo:id/btn_login')
  })
})
