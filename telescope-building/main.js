gsap.registerPlugin(ScrollTrigger, ScrollSmoother)

class Animation {
  constructor() {
    this.dom = document.querySelector(".section")
    this.frontImages = this.dom.querySelectorAll(".section__media__front")
    this.smallImages = this.dom.querySelectorAll(".section__images img")
  }

  init() {
    this.timeline = gsap.timeline({
      scrollTrigger: {
        trigger: this.dom,
        start: "top top",
        end: "bottom top",
        scrub: true,
        pin: true,
        onUpdate: (self) => {
          const easedProgress = gsap.parseEase("power1.inOut")(self.progress)
          this.dom.style.setProperty("--progress", easedProgress)
        }
      }
    })

    this.animate()
  }

  animate() {
    gsap.set(this.smallImages, {
      transformStyle: "preserve-3d",
      backfaceVisibility: "hidden",
      force3D: true
    })

    this.timeline.to(this.smallImages, {
      z: "100vh",
      duration: 1,
      ease: "power1.inOut",
      stagger: {
        amount: 0.2,
        from: "center"
      }
    })

    this.timeline.to(this.frontImages, {
      scale: 1,
      duration: 1,
      ease: "power1.inOut",
      delay: 0.1
    }, 0.6)

    this.timeline.to(this.frontImages, {
      duration: 1,
      filter: "blur(0px)",
      ease: "power1.inOut",
      delay: 0.4,
      stagger: {
        amount: 0.2,
        from: "end"
      }
    }, 0.6)
  }
}

// Resolve once every image on the page has finished loading (or failed).
const preloadImages = (selector = "img") =>
  Promise.all(
    [...document.querySelectorAll(selector)].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true })
            img.addEventListener("error", resolve, { once: true })
          })
    )
  )

ScrollSmoother.create({
  wrapper: ".wrapper",
  content: ".content",
  smooth: 1.5,
  effects: true,
  normalizeScroll: true
})

const animation = new Animation()
const fontReady = document.fonts ? document.fonts.ready : Promise.resolve()

Promise.all([preloadImages(".wrapper img"), fontReady]).then(() => {
  animation.init()
  document.body.classList.remove("loading")
})
