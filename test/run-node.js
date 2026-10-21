// node --test test/  (Node 18+)
import { test } from "node:test";
import { tests } from "./caiman.spec.js";

for (const [name, fn] of tests) test(name, fn);
