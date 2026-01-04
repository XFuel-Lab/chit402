#!/bin/bash
# XFUEL Whitepaper PDF Generator (macOS/Linux)
# Usage: ./generate-whitepaper-pdf.sh

set -e  # Exit on error

echo "================================"
echo "XFUEL Whitepaper PDF Generator"
echo "================================"
echo

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo "Please install Node.js 24+ from https://nodejs.org"
    exit 1
fi

echo "Node.js version:"
node --version
echo

# Check if required packages are installed
echo "Checking dependencies..."

if ! npm list -g marked &> /dev/null; then
    echo "Installing 'marked' globally..."
    npm install -g marked
fi

if ! npm list -g puppeteer &> /dev/null; then
    echo "Installing 'puppeteer' globally..."
    npm install -g puppeteer
fi

echo
echo "Dependencies installed!"
echo

# Navigate to whitepaper directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/docs/whitepaper"

# Generate PDF
echo "Generating PDF from markdown..."
echo
node generate-pdf-v2.mjs

if [ $? -eq 0 ]; then
    echo
    echo "================================"
    echo "SUCCESS! PDF generated."
    echo "================================"
    echo
    echo "Output: docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.pdf"
    echo "Preview: docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.html"
    echo
    
    # Ask if user wants to open PDF
    read -p "Open PDF now? (y/n): " OPEN_PDF
    if [ "$OPEN_PDF" = "y" ] || [ "$OPEN_PDF" = "Y" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            open XFUEL-ZK-Bridge-Whitepaper.pdf
        else
            # Linux
            xdg-open XFUEL-ZK-Bridge-Whitepaper.pdf 2>/dev/null || echo "Please open the PDF manually"
        fi
    fi
else
    echo
    echo "================================"
    echo "ERROR: PDF generation failed!"
    echo "================================"
    echo
    echo "Check the error messages above."
    exit 1
fi

echo

