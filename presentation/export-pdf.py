from pathlib import Path
from reportlab.pdfgen import canvas

base = Path(__file__).resolve().parent
slides = sorted((base / ".build").glob("slide-*.png"))
output = base / "TransitScope_HCI_Lab2.pdf"
c = canvas.Canvas(str(output), pagesize=(960, 540))
for slide in slides:
    c.drawImage(str(slide), 0, 0, width=960, height=540, preserveAspectRatio=True, mask="auto")
    c.showPage()
c.save()
print(f"Wrote {output} with {len(slides)} pages")
