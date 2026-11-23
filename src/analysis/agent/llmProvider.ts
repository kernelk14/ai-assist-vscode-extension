import * as vscode from "vscode";
import { log } from "../../utils/logger";

export interface LlmResponse {
  text: string;
  model: string;
}

export async function runWithVsCodeLm(prompt: string, token: vscode.CancellationToken): Promise<LlmResponse | undefined> {
  try {
    const models = await vscode.lm.selectChatModels();
    if (!models || models.length === 0) {
      log("No VS Code language models available; falling back to static-only analysis.");
      return undefined;
    }

    const model = pickModel(models);
    log(`Using VS Code LM: ${model.vendor}/${model.family}/${model.id}`);
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, token);

    let text = "";
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        break;
      }
      text += fragment;
    }
    return { text, model: `${model.vendor}/${model.family}` };
  } catch (err) {
    log(`VS Code LM request failed: ${String(err)}`);
    return undefined;
  }
}

function pickModel(models: readonly vscode.LanguageModelChat[]): vscode.LanguageModelChat {
  const preferredFamilies = ["gpt-4o", "gpt-4", "claude", "copilot"];
  for (const family of preferredFamilies) {
    const match = models.find((m) => m.family.toLowerCase().includes(family));
    if (match) return match;
  }
  return models[0];
}
