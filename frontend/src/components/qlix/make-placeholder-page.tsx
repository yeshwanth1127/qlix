import { PlaceholderConsolePage } from "./placeholder-console-page";

export function makePlaceholderPage(title: string, description: string) {
  return function PlaceholderPage() {
    return <PlaceholderConsolePage title={title} description={description} />;
  };
}
