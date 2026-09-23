'use client'

// `/pantry` runs the same loader as `/shopping` (`../shopping/load-inventory`),
// fetching the pantry and the shopping list together, so it fails the same way
// and shows the same boundary.
export { default } from '../shopping/error'
