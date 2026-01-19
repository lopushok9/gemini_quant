import type { SVGProps } from "react"

const ChatIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 20 20" fill="none" {...props}>
    <path
      fill="currentColor"
      d="M3.333 3.333h-.833v.834h.833v-.834Zm13.334 0v-.833h-.834v.833h.834Zm0 9.167h.833v-.833h-.833v.833Zm-3.334 3.333.589.589.244-.244v-.345h-.833Zm-3.333 0v.834h.833v-.834h-.833Zm-6.667-3.333h-.833v.833h.833v-.833Zm0-9.167V4.167h13.334V3.333H3.333Zm13.334 0v.834V12.5h1.666V3.333h-1.666Zm0 9.167v-.833h-3.334v1.666h3.334v-.833Zm-3.334 0v-.833V12.5v3.333h1.667V12.5h-1.667Zm.833 2.744-.589-.589-1.178 1.178.589.589 1.178-1.178Zm-3.833-.244h-.833h-6.667v1.666h6.667V15Zm-6.667 0h.833V12.5H2.5v2.5h.833v-2.5Zm0-2.5V4.167H1.667V12.5h1.666Zm1.667-1.667h10v-1.666h-10v1.666Zm0-3.333h10V6.667h-10v1.666Z"
    />
  </svg>
)

export default ChatIcon
