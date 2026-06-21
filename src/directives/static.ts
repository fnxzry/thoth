import { register } from "./index.js";
import { DirectiveImpl } from "../types.js";

const staticDirective: DirectiveImpl = async (ctx) => {
  return { text: typeof ctx.params.body === "string" ? ctx.params.body : "" };
};

register("static", null, staticDirective);