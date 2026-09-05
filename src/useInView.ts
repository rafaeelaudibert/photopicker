import { useEffect, useState, type RefObject } from 'react'

const callbacks = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | null = null

function shared(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) callbacks.get(entry.target)?.()
        }
      },
      // Decode a screen ahead so scrolling stays ahead of the worker pool.
      { rootMargin: '600px 0px' },
    )
  }
  return observer
}

/** Latches true the first time the element comes near the viewport. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    const io = shared()
    callbacks.set(el, () => setInView(true))
    io.observe(el)
    return () => {
      io.unobserve(el)
      callbacks.delete(el)
    }
  }, [ref, inView])

  return inView
}
