const path = require('path');
const fs = require('fs');
const { glob } = require('glob');

async function copyIcons() {
	// Copy node icons
	const nodeFiles = await glob('nodes/**/*.{png,svg}');
	for (const file of nodeFiles) {
		const destPath = path.join('dist', file);
		const destDir = path.dirname(destPath);
		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true });
		}
		fs.copyFileSync(file, destPath);
		console.log(`Copied: ${file} -> ${destPath}`);
	}

	// Copy credential icons
	const credFiles = await glob('credentials/**/*.{png,svg}');
	for (const file of credFiles) {
		const destPath = path.join('dist', file);
		const destDir = path.dirname(destPath);
		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true });
		}
		fs.copyFileSync(file, destPath);
		console.log(`Copied: ${file} -> ${destPath}`);
	}

	console.log('Icon copy complete!');
}

copyIcons().catch(err => {
	console.error('Error copying icons:', err);
	process.exit(1);
});
