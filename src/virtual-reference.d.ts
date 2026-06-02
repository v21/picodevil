declare module "*.html?raw" {
  const content: string;
  export default content;
}

declare module "virtual:reference-data" {
  const data: Array<{
    name: string;
    sourceFile: string;
    entries: Array<{
      name: string;
      description: string;
      params: string[];
      examples: string[];
      aliases: string[];
      isMethod: boolean;
    }>;
  }>;
  export default data;
}
