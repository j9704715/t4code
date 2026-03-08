import { expect, test } from "bun:test"
import { parseFirstIpv4 } from "./tailscale.js"

test("parses the first tailnet ipv4 from tailscale output", () => {
  expect(parseFirstIpv4("100.70.1.2\nfd7a:115c:a1e0::12")).toBe("100.70.1.2")
  expect(parseFirstIpv4("no ip here")).toBeUndefined()
})
