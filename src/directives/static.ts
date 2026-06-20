import { register } from "./index.js";
import { DirectiveImpl } from "../types.js";

const staticDirective: DirectiveImpl = async (ctx) => {
  return { text: ctx.block.kind === "directive" ? ctx.block.body : "" };
};

register("static", staticDirective);