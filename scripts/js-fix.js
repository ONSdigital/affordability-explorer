import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixJSMimeTypes(dir) {
  const files = [];

  function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath);
    entries.forEach((file) => {
      const fullPath = path.join(currentPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        walkDir(fullPath);
      } else if (fullPath.endsWith(".js")) {
        files.push(fullPath);
      }
    });
  }

  walkDir(dir);

  files.forEach((file) => {
    let content = fs.readFileSync(file, "utf8");
    if (!content.startsWith("//js\n")) {
      content = "//js\n" + content;
      fs.writeFileSync(file, content);
    }
  });

  console.log(`Fixed ${files.length} JS files to avoid mimetype errors...`);
}

fixJSMimeTypes(path.join(__dirname, "../build/_app"));
