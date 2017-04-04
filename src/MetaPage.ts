import { StreamUtil } from './StreamUtil';
import {
	MetaObject, MetaObjectDraw, MetaObjectExport, MetaObjectText, PageSizeDetail, MetaBase,
	MetaObjectImage, MetaObjectPolygon, AlignmentFlags, MetaObjectType, OrientationType,
	ArrayBufferList, MetaSeparator
} from './MetaTypes';
import { Translator } from './Translator'

export class MetaPage {
	public UpdatedPageSize: boolean;
	public Objects: MetaObject[] = [];
	public Orientation: OrientationType;
	/// <summary>Page size information, filled when UpdatedPageSize is true</summary>
	public PageDetail: PageSizeDetail;
	private stringlist: { [id: string]: number } = {};
	private strings: string[] = [];
	public buffers: ArrayBufferList = new ArrayBufferList();

	public get PhysicWidth(): number {
		if (this.UpdatedPageSize) {
			return this.PageDetail.PhysicWidth;
		}
		else {
			return this.Metafile.CustomX;
		}
	}
	/// <summary>Physic height of the page</summary>
	public get PhysicHeight() {
		if (this.UpdatedPageSize) {
			return this.PageDetail.PhysicHeight;
		}
		else {
			return this.Metafile.CustomY;
		}
	}
	public constructor(public Metafile: MetaBase) {


	}
	public Clear(): void {
		this.Objects.splice(0, this.Objects.length);
		this.stringlist = {};
		this.buffers.clear();
	}
	public AddString(value: string): number {
		if (value == undefined)
			value = "";
		let avalue: number = this.stringlist[value];
		if (avalue != undefined)
			return avalue;
		let newindex = this.strings.length;
		this.strings.push(value);
		this.stringlist[value] = newindex;
		return newindex;
	}
	public GetText(obj: MetaObjectText): string {
		let ares: string = this.strings[obj.TextP];
		return ares;
	}
	public GetWFontNameText(obj: MetaObjectText): string {
		return this.strings[obj.WFontNameP];
	}
	public GetLFontNameText(obj: MetaObjectText): string {
		return this.strings[obj.LFontNameP];
	}
	public GetStream(obj: MetaObjectImage): ArrayBuffer {
		if (obj.SharedImage) {
			return this.Metafile.buffers.getBuffer(obj.StreamPos);
		}
		else {
			return this.buffers.getBuffer(obj.StreamPos);
		}
	}
	public AddStream(buf: ArrayBuffer, shared: boolean): number {
		if (shared) {
			return this.Metafile.buffers.addBuffer(buf);
		}
		else {
			return this.buffers.addBuffer(buf);
		}
	}
	public LoadFromStream(stream: ArrayBuffer): void {
		let index = 0;
		let separator: MetaSeparator = MetaSeparator.ObjectHeader;
		{
			let header = StreamUtil.byteArrayToInt(stream, index);
			if (header !== <number>separator)
				throw new Error(Translator.TranslateStr(523));
			index = index + 4;
		}
		// Mark begin
		index = index + 4;

		this.Orientation = <OrientationType>StreamUtil.byteArrayToInt(stream, index);
		index = index + 4;
		/*				ReadBuf(astream, ref buf, 4);
						PageDetail.Index = StreamUtil.ByteArrayToInt(buf, 4);
						ReadBuf(astream, ref buf, 1);
						PageDetail.Custom = StreamUtil.ByteArrayToInt(buf, 1) != 0;
						ReadBuf(astream, ref buf, 4);
						PageDetail.CustomWidth = StreamUtil.ByteArrayToInt(buf, 4);
						ReadBuf(astream, ref buf, 4);
						PageDetail.CustomHeight = StreamUtil.ByteArrayToInt(buf, 4);
						ReadBuf(astream, ref buf, 4);
						PageDetail.PhysicWidth = StreamUtil.ByteArrayToInt(buf, 4);
						ReadBuf(astream, ref buf, 4);
						PageDetail.PhysicHeight = StreamUtil.ByteArrayToInt(buf, 4);
						ReadBuf(astream, ref buf, 4);
						PageDetail.PaperSource = StreamUtil.ByteArrayToInt(buf, 4);
						ReadBuf(astream, ref buf, 61);
						PageDetail.ForcePaperName = StreamUtil.ByteArrayToString(buf, 61);
		
						ReadBuf(astream, ref buf, 4);
						PageDetail.Duplex = StreamUtil.ByteArrayToInt(buf, 4);
						// Record alignment
						ReadBuf(astream, ref buf, 3);
		
						ReadBuf(astream, ref buf, 1);
						UpdatedPageSize = StreamUtil.ByteArrayToInt(buf, 1) != 0;
		
					ReadBuf(astream, ref buf, 4);
					int objcount = StreamUtil.ByteArrayToInt(buf, 4);
					if (objcount < 0)
						throw new Exception(Translator.TranslateStr(523));
					buf = new byte[objcount * MetaObject.RECORD_SIZE];
					ReadBuf(astream, ref buf, objcount * MetaObject.RECORD_SIZE);
		
					Objects.Clear();
					for (i = 0; i < objcount; i++)
					{
						MetaObject obj = MetaObject.CreateFromBuf(buf, i * MetaObject.RECORD_SIZE);
						obj.FillFromBuf(buf, i * MetaObject.RECORD_SIZE);
						Objects.Add(obj);
					}
		
		
					// String pool
					buf = new byte[5];
					ReadBuf(astream, ref buf, 4);
					int wsize = StreamUtil.ByteArrayToInt(buf, 4);
					if (wsize < 0)
						throw new Exception(Translator.TranslateStr(523));
					buf = new byte[wsize];
					ReadBuf(astream, ref buf, wsize);
					if (FPool.Length < wsize)
					{
						FPool = new char[wsize];
					}
					for (i = 0; i < (wsize / 2); i++)
					{
						FPool[i] = (char)((int)buf[i * 2] + (int)(buf[i * 2 + 1] << 8));
					}
					FPoolPos = wsize / 2 + 1;
		
					// Update stringlist
					for (i = 0; i < Objects.Count; i++)
					{
						MetaObject obj = Objects[i];
						switch (obj.MetaType)
						{
							case MetaObjectType.Text:
								MetaObjectText atext = (MetaObjectText)obj;
								string WFontName = GetWFontNameText(atext);
								if (stringlist.IndexOfKey(WFontName) < 0)
									stringlist.Add(WFontName, atext.WFontNameP);
								string LFontName = GetWFontNameText(atext);
								if (stringlist.IndexOfKey(LFontName) < 0)
									stringlist.Add(LFontName, atext.LFontNameP);
								string Text = GetText(atext);
								if (stringlist.IndexOfKey(Text) < 0)
									stringlist.Add(Text, atext.TextP);
								break;
		
						}
					}
					// Read Stream
					// Stream
					buf = new byte[9];
					ReadBuf(astream, ref buf, 8);
					long asize = StreamUtil.ByteArrayToLong(buf, 8);
					if (asize < 0)
						throw new Exception(Translator.TranslateStr(523));
					if (asize > 0)
					{
						buf = new byte[asize];
						ReadBuf(astream, ref buf, (int)asize);
						FMemStream = new MemoryStream((int)asize);
						FMemStream.Write(buf, 0, (int)asize);
					}
					buf = new byte[9];*/
	}
	/*		
	public void SaveToStream(Stream astream)
	{
		int separator=(int)MetaSeparator.ObjectHeader;
		astream.Write(StreamUtil.IntToByteArray(separator),0,4);
		astream.Write(StreamUtil.IntToByteArray(0),0,4);
		int ainteger=(int)Orientation;
		astream.Write(StreamUtil.IntToByteArray(ainteger),0,4);
		astream.Write(StreamUtil.IntToByteArray(PageDetail.Index),0,4);
		astream.Write(StreamUtil.BoolToByteArray(PageDetail.Custom),0,1);
		astream.Write(StreamUtil.IntToByteArray(PageDetail.CustomWidth),0,4);
		astream.Write(StreamUtil.IntToByteArray(PageDetail.CustomHeight),0,4);
		astream.Write(StreamUtil.IntToByteArray(PageDetail.PhysicWidth),0,4);
		astream.Write(StreamUtil.IntToByteArray(PageDetail.PhysicHeight),0,4);
		astream.Write(StreamUtil.IntToByteArray(PageDetail.PaperSource),0,4);
		astream.Write(StreamUtil.StringToByteArray(PageDetail.ForcePaperName,61),0,61);
		astream.Write(StreamUtil.IntToByteArray(PageDetail.Duplex),0,4);
		// Record alignment
		astream.Write(StreamUtil.IntToByteArray(0),0,3);

		astream.Write(StreamUtil.BoolToByteArray(UpdatedPageSize),0,1);
		astream.Write(StreamUtil.IntToByteArray(Objects.Count),0,4);

		for (int i=0;i<Objects.Count;i++)
		{
			Objects[i].SaveToStream(astream);
		}
		int wsize=FPoolPos*2;
		astream.Write(StreamUtil.IntToByteArray(wsize),0,4);
		if (wsize>0)
		{
			StreamUtil.WriteCharArrayToStream(FPool,FPoolPos,astream);
		}
		long asize=FMemStream.Length;
		astream.Write(StreamUtil.LongToByteArray(asize),0,8);
		FMemStream.Seek(0,SeekOrigin.Begin);
		FMemStream.WriteTo(astream);
	}*/
	/*        public MetaObjectText DrawText(int PosX,int PosY,int PrintWidth,int PrintHeight,string Text,string WFontName,string LFontName,short FontSize,short FontRotation,int FontColor,
				 int BackColor,bool Transparent,int FontStyle,PDFFontType Type1Font,TextAlignType horzalign,TextAlignVerticalType vertalign,bool SingleLine,bool WordWrap,bool CutText,
				PrintStepType PrintStep)
			{
				MetaObjectText metaobj = new MetaObjectText();
				metaobj.TextP = AddString(Text);
				metaobj.TextS = Text.Length;
				metaobj.LFontNameP = AddString(LFontName);
				metaobj.LFontNameS = LFontName.Length;
				metaobj.WFontNameP = AddString(WFontName);
				metaobj.WFontNameS = WFontName.Length;
				metaobj.FontSize = FontSize;
				metaobj.BackColor = BackColor;
				metaobj.FontRotation = FontRotation;
				metaobj.FontStyle = (short)FontStyle;
				metaobj.FontColor = FontColor;
				metaobj.Type1Font = Type1Font;
				metaobj.CutText = CutText;
				metaobj.Transparent = Transparent;
				metaobj.WordWrap = WordWrap;
				metaobj.Top = PosY;
				metaobj.Left = PosX;
				metaobj.Width = PrintWidth;
				metaobj.Height = PrintHeight;
				//			metaobj.RightToLeft=RightToLeft;
				metaobj.PrintStep = PrintStep;
				int aalign = MetaObject.GetIntHorizAlignment(horzalign) | MetaObject.GetIntVertAlignment(vertalign);
				if (SingleLine)
					aalign = aalign | MetaFile.AlignmentFlags_SingleLine;
				metaobj.Alignment = aalign;
				Objects.Add(metaobj);
				return metaobj;
			}
			public MetaObjectDraw DrawShape(int PosX, int PosY, int PrintWidth, int PrintHeight, ShapeType Shape, BrushType BrushStyle, PenType PenStyle,
				int PenWidth,int PenColor,int BrushColor)
			{
				MetaObjectDraw metaobj = new MetaObjectDraw();
				metaobj.MetaType = MetaObjectType.Draw;
				metaobj.Top = PosY; metaobj.Left = PosX;
				metaobj.Width = PrintWidth; metaobj.Height = PrintHeight;
				metaobj.DrawStyle = Shape;
				metaobj.BrushStyle = (int)BrushStyle;
				metaobj.PenStyle = (int)PenStyle;
				metaobj.PenWidth = PenWidth;
				metaobj.PenColor = PenColor;
				metaobj.BrushColor = BrushColor;
				Objects.Add(metaobj);
				return metaobj;
			}
			public MetaObjectImage DrawImage(int PosX,int PosY,int PrintWidth,int PrintHeight,ImageDrawStyleType DrawStyle,int dpires,
				object nvalue)
			{
				MetaObjectImage metaobj = new MetaObjectImage();
				metaobj.MetaType = MetaObjectType.Image;
				metaobj.Top = PosY; metaobj.Left = PosX;
				metaobj.Width = PrintWidth;
				metaobj.Height = PrintHeight;
				metaobj.CopyMode = 20;
				metaobj.DrawImageStyle = DrawStyle;
				metaobj.DPIRes = dpires;
				metaobj.PreviewOnly = false;
				if (nvalue is MemoryStream)
				{
					MemoryStream xstream = (MemoryStream)nvalue;
					metaobj.StreamPos = AddStream(xstream, false);
					metaobj.StreamSize = xstream.Length;
				}
				else
				{
	#if NODRAWING
					throw new Exception("DrawImage must be a memory stream");
	#else
					if (nvalue is Image)
					{
						Image nimage = (Image)nvalue;
						using (MemoryStream mstream = new MemoryStream())
						{
							nimage.Save(mstream, ImageFormat.Jpeg);
						}
					}
					else
						if (nvalue != DBNull.Value)
							if (nvalue != null)
								throw new Exception("Unsupported type MetaPage.DrawImage");
	#endif
				}            
				Objects.Add(metaobj);
				return metaobj;
			}
		}
		/// <summary>
		/// Collection of pages
		/// </summary>
		public class MetaPages
		{
			const int FIRST_ALLOCATION_OBJECTS = 50;
			MetaFile metafile;
			MetaPage[] FPages;
			int FCount;
			/// <summary>
			/// Constructor
			/// </summary>
			/// <param name="meta">Parent MetaFile</param>
			public MetaPages(MetaFile meta)
			{
				FCount = 0;
				FPages = new MetaPage[FIRST_ALLOCATION_OBJECTS];
				metafile = meta;
			}
			/// <summary>
			/// Clear the collection, freeing pages
			/// </summary>
			public void Clear()
			{
				for (int i = 0; i < FCount; i++)
				{
					FPages[i].Clear();
			FPages[i].Dispose();
					FPages[i] = null;
				}
				FCount = 0;
			}
			/// <summary>
			/// Current page count
			/// </summary>
			public int CurrentCount
			{
				get { return FCount; }
			}
			/// <summary>
			/// Force report processing until the page requested, else throw an exception
			/// </summary>
			/// <param name="index">Index requested</param>
			private void CheckRange(int index)
			{
				metafile.RequestPage(index);
				if ((index < 0) || (index >= FCount))
					throw new Exception("Index out of range on MetaPage collection");
			}
			/// <summary>
			/// Access page by index
			/// </summary>
			/// <param name="index">Index requested</param>
			/// <returns>MetaPage in this index</returns>
			public MetaPage this[int index]
			{
				get 
				{ 
					CheckRange(index);
						return FPages[index]; 
				}
				
				set { CheckRange(index); FPages[index] = value; }
			}
			/// <summary>
			/// Retrieve the page count, the report processing will be done until the
			/// total number of pages is known
			/// </summary>
			public int Count
			{
				get
				{
					metafile.RequestPage(int.MaxValue);
					return FCount;
				}
			}
			/// <summary>
			/// Add a metapage to the collection
			/// </summary>
			/// <param name="obj">MetaPage to add</param>
			public void Add(MetaPage obj)
			{
				if (FCount > (FPages.Length - 2))
				{
					MetaPage[] npages = new MetaPage[FCount];
					System.Array.Copy(FPages, 0, npages, 0, FCount);
					FPages = new MetaPage[FPages.Length * 2];
					System.Array.Copy(npages, 0, FPages, 0, FCount);
				}
	
				FPages[FCount] = obj;
				FCount++;
				if (metafile.ForwardOnly)
				{
					if (FCount > 2)
					{
	//					FPages[FCount - 333].Clear();
					}
				}
			}*/
}


